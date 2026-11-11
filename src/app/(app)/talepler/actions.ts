"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { FireplaceType, LeadSource } from "@prisma/client";
import { prisma } from "@/lib/db";
import { audit } from "@/lib/audit";
import { failure, fieldErrors, formObject, zCheckbox, zOptional, zUuidOpt, type ActionState } from "@/lib/action";
import { getActorOrNull, assertCan } from "@/lib/rbac/guard";
import { normalizeEmail, normalizePhone } from "@/lib/normalize";
import { quickIntake } from "@/lib/services/intake";

const schema = z
  .object({
    name: z.string().trim().min(2, "Ad soyad yazın.").max(120),
    phone: zOptional(40),
    email: zOptional(160),
    city: zOptional(60),
    district: zOptional(60),
    source: z.enum(LeadSource, { error: "Kaynak seçin." }),
    fireplaceType: z
      .string()
      .optional()
      .transform((v) => (v ? (v as FireplaceType) : null))
      .refine((v) => v === null || v in FireplaceType, "Geçersiz seçim."),
    productCategory: zOptional(120),
    productModel: zOptional(120),
    message: zOptional(4000),
    ownerId: zUuidOpt,
    kvkkNotice: zCheckbox,
    marketingConsent: zCheckbox,
    contactChoice: z.string().optional(),
    leadId: zUuidOpt,
  })
  .superRefine((v, ctx) => {
    if (!v.phone && !v.email) ctx.addIssue({ code: "custom", path: ["phone"], message: "Telefon veya e-posta yazın." });
    if (v.phone && !normalizePhone(v.phone)) ctx.addIssue({ code: "custom", path: ["phone"], message: "Geçerli bir telefon numarası yazın (ör. 0532 123 45 67)." });
    if (v.email && !normalizeEmail(v.email)) ctx.addIssue({ code: "custom", path: ["email"], message: "Geçerli bir e-posta adresi yazın." });
  });

export async function quickIntakeAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await getActorOrNull();
  if (!actor) return { ok: false, message: "Oturumunuz sona erdi. Lütfen yeniden giriş yapın." };
  const parsed = schema.safeParse(formObject(fd));
  if (!parsed.success) return { ok: false, errors: fieldErrors(parsed.error), message: "Lütfen işaretli alanları düzeltin." };
  try {
    const choice = parsed.data.contactChoice || undefined;
    if (choice && choice !== "new" && !/^[0-9a-f-]{36}$/i.test(choice)) return { ok: false, message: "Geçersiz müşteri seçimi." };
    const r = await quickIntake(actor, { ...parsed.data, contactChoice: choice });
    if (r.kind === "needs_choice") {
      return { ok: false, message: "Bu telefon/e-posta ile kayıtlı müşteri bulundu. Mevcut kayda bağlayın ya da bilerek yeni müşteri açın.", data: { candidates: r.candidates } };
    }
    revalidatePath("/");
    return { ok: true, message: r.reusedContact ? "Mevcut müşteriye yeni fırsat açıldı." : "Müşteri ve fırsat oluşturuldu.", redirectTo: `/firsatlar/${r.opportunityId}` };
  } catch (e) {
    return failure(e);
  }
}

/** Talep reddi (spam / test / yanlış başvuru). Silinmez; durum DISCARDED olur ve denetime yazılır. */
export async function discardLead(fd: FormData) {
  const actor = await getActorOrNull();
  if (!actor) return;
  assertCan(actor, "leads.process");
  const id = String(fd.get("id"));
  const lead = await prisma.lead.findUnique({ where: { id }, select: { id: true, status: true, name: true } });
  if (!lead || lead.status !== "RECEIVED") return;
  await prisma.lead.update({ where: { id }, data: { status: "DISCARDED", processedAt: new Date() } });
  await audit({ actorId: actor.id, action: "lead_discarded", entityType: "lead", entityId: id, summary: lead.name });
  revalidatePath("/talepler");
}
