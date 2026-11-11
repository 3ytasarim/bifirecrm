"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ChimneyStatus, FireplaceType, GlassOrientation, LeadSource, OpportunityStage } from "@prisma/client";
import { failure, fieldErrors, formObject, zMoney, zOptional, zUuidOpt, type ActionState } from "@/lib/action";
import { istanbulLocalToDate, parseDateOnly } from "@/lib/format";
import { getActorOrNull } from "@/lib/rbac/guard";
import { archiveOpportunity, createOpportunity, moveOpportunity, updateOpportunity } from "@/lib/services/opportunities";
import { createProjectFromOpportunity } from "@/lib/services/projects";

const NO_SESSION: ActionState = { ok: false, message: "Oturumunuz sona erdi. Lütfen yeniden giriş yapın." };

const optEnum = <T extends Record<string, string>>(e: T) =>
  z
    .string()
    .optional()
    .transform((v) => (v ? (v as T[keyof T]) : null))
    .refine((v) => v === null || v in e, "Geçersiz seçim.");

const oppSchema = z.object({
  title: z.string().trim().min(2, "Başlık yazın.").max(200),
  contactId: z.string().optional(),
  source: z.enum(LeadSource),
  ownerId: zUuidOpt,
  fireplaceType: optEnum(FireplaceType),
  productCategory: zOptional(120),
  productModel: zOptional(120),
  city: zOptional(60),
  district: zOptional(60),
  message: zOptional(4000),
  estimatedAmount: zMoney,
  currency: z.enum(["TRY", "EUR", "USD"]),
  expectedCloseDate: z
    .string()
    .optional()
    .transform((v) => parseDateOnly(v)),
  nextActionAt: z
    .string()
    .optional()
    .transform((v) => (v ? istanbulLocalToDate(v) : null)),
  nextActionNote: zOptional(300),
});

export async function createOpportunityAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await getActorOrNull();
  if (!actor) return NO_SESSION;
  const parsed = oppSchema.safeParse(formObject(fd));
  if (!parsed.success) return { ok: false, errors: fieldErrors(parsed.error), message: "Lütfen işaretli alanları düzeltin." };
  if (!parsed.data.contactId || !/^[0-9a-f-]{36}$/i.test(parsed.data.contactId)) return { ok: false, errors: { contactId: "Müşteri seçin." } };
  try {
    const o = await createOpportunity(actor, { ...parsed.data, contactId: parsed.data.contactId });
    revalidatePath("/firsatlar");
    return { ok: true, message: "Fırsat oluşturuldu.", redirectTo: `/firsatlar/${o.id}` };
  } catch (e) {
    return failure(e);
  }
}

export async function updateOpportunityAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await getActorOrNull();
  if (!actor) return NO_SESSION;
  const id = String(fd.get("id"));
  const parsed = oppSchema.safeParse(formObject(fd));
  if (!parsed.success) return { ok: false, errors: fieldErrors(parsed.error), message: "Lütfen işaretli alanları düzeltin." };
  try {
    const { contactId: _c, ownerId, ...rest } = parsed.data;
    void _c;
    await updateOpportunity(actor, id, { ...rest, ownerId: actor.perms.has("opportunities.assign") ? ownerId : undefined });
    revalidatePath(`/firsatlar/${id}`);
    return { ok: true, message: "Kaydedildi." };
  } catch (e) {
    return failure(e);
  }
}

const moveSchema = z.object({
  id: z.string().uuid(),
  stage: z.enum(OpportunityStage),
  beforeId: z.string().uuid().nullable().optional(),
  afterId: z.string().uuid().nullable().optional(),
  lostReason: z.string().trim().max(200).nullable().optional(),
  lostNote: z.string().trim().max(2000).nullable().optional(),
});

/** Kanban sürükle-bırak: kalıcı olarak DB'ye yazılır. */
export async function moveOpportunityAction(input: z.input<typeof moveSchema>): Promise<{ ok: boolean; message?: string }> {
  const actor = await getActorOrNull();
  if (!actor) return { ok: false, message: "Oturumunuz sona erdi." };
  const parsed = moveSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Geçersiz istek." };
  try {
    await moveOpportunity(actor, parsed.data.id, parsed.data.stage, parsed.data);
    revalidatePath("/firsatlar");
    revalidatePath(`/firsatlar/${parsed.data.id}`);
    return { ok: true };
  } catch (e) {
    const f = failure(e);
    return { ok: false, message: f.message };
  }
}

export async function changeStageAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = await moveOpportunityAction({
    id: String(fd.get("id")),
    stage: String(fd.get("stage")) as OpportunityStage,
    lostReason: (fd.get("lostReason") as string) || null,
    lostNote: (fd.get("lostNote") as string) || null,
  });
  return r.ok ? { ok: true, message: "Aşama güncellendi." } : { ok: false, message: r.message };
}

export async function archiveOpportunityAction(fd: FormData) {
  const actor = await getActorOrNull();
  if (!actor) return;
  await archiveOpportunity(actor, String(fd.get("id")));
  revalidatePath("/firsatlar");
  const { redirect } = await import("next/navigation");
  redirect("/firsatlar");
}

const projectSchema = z.object({
  name: z.string().trim().min(2, "Proje adı yazın.").max(200),
  fireplaceType: optEnum(FireplaceType),
  productCategory: zOptional(120),
  productModel: zOptional(120),
  siteAddress: zOptional(400),
  siteCity: zOptional(60),
  siteDistrict: zOptional(60),
  chimneyStatus: z.enum(ChimneyStatus),
  glassOrientation: optEnum(GlassOrientation),
  technicalUserId: zUuidOpt,
  installationUserId: zUuidOpt,
});

export async function createProjectAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await getActorOrNull();
  if (!actor) return NO_SESSION;
  const parsed = projectSchema.safeParse(formObject(fd));
  if (!parsed.success) return { ok: false, errors: fieldErrors(parsed.error), message: "Lütfen işaretli alanları düzeltin." };
  try {
    const p = await createProjectFromOpportunity(actor, String(fd.get("opportunityId")), parsed.data);
    revalidatePath("/projeler");
    return { ok: true, message: "Proje açıldı.", redirectTo: `/projeler/${p.id}` };
  } catch (e) {
    return failure(e);
  }
}
