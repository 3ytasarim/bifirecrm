"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ChimneyStatus, FireplaceType, GlassOrientation, ProjectStage } from "@prisma/client";
import { failure, fieldErrors, formObject, zDecimal, zOptional, zUuidOpt, type ActionState } from "@/lib/action";
import { istanbulLocalToDate, parseDateOnly } from "@/lib/format";
import { getActorOrNull } from "@/lib/rbac/guard";
import { approveProjectDates, moveProjectStage, updateProject } from "@/lib/services/projects";

const NO_SESSION: ActionState = { ok: false, message: "Oturumunuz sona erdi. Lütfen yeniden giriş yapın." };
const optEnum = <T extends Record<string, string>>(e: T) =>
  z
    .string()
    .optional()
    .transform((v) => (v ? (v as T[keyof T]) : null))
    .refine((v) => v === null || v in e, "Geçersiz seçim.");
const dateOnly = z
  .string()
  .optional()
  .transform((v) => parseDateOnly(v));

const schema = z.object({
  name: z.string().trim().min(2, "Proje adı yazın.").max(200),
  fireplaceType: optEnum(FireplaceType),
  productCategory: zOptional(120),
  productModel: zOptional(120),
  siteAddress: zOptional(400),
  siteCity: zOptional(60),
  siteDistrict: zOptional(60),
  wallWidthCm: zDecimal,
  ceilingHeightCm: zDecimal,
  chimneyStatus: z.enum(ChimneyStatus),
  glassOrientation: optEnum(GlassOrientation),
  cladding: zOptional(200),
  technicalNotes: zOptional(8000),
  surveyDate: z
    .string()
    .optional()
    .transform((v) => (v ? istanbulLocalToDate(v) : null)),
  ownerId: zUuidOpt,
  technicalUserId: zUuidOpt,
  installationUserId: zUuidOpt,
  plannedShipDate: dateOnly,
  plannedInstallDate: dateOnly,
  holdReason: zOptional(400),
});

export async function updateProjectAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await getActorOrNull();
  if (!actor) return NO_SESSION;
  const id = String(fd.get("id"));
  const parsed = schema.safeParse(formObject(fd));
  if (!parsed.success) return { ok: false, errors: fieldErrors(parsed.error), message: "Lütfen işaretli alanları düzeltin." };
  try {
    await updateProject(actor, id, parsed.data);
    revalidatePath(`/projeler/${id}`);
    return { ok: true, message: "Proje kaydedildi." };
  } catch (e) {
    return failure(e);
  }
}

export async function projectStageAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await getActorOrNull();
  if (!actor) return NO_SESSION;
  const id = String(fd.get("id"));
  const stage = String(fd.get("stage"));
  if (!(stage in ProjectStage)) return { ok: false, message: "Geçersiz aşama." };
  try {
    await moveProjectStage(actor, id, stage as ProjectStage, (fd.get("note") as string) || null);
    revalidatePath(`/projeler/${id}`);
    revalidatePath("/projeler");
    return { ok: true, message: "Aşama güncellendi." };
  } catch (e) {
    return failure(e);
  }
}

export async function approveDatesAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await getActorOrNull();
  if (!actor) return NO_SESSION;
  const id = String(fd.get("id"));
  try {
    await approveProjectDates(actor, id);
    revalidatePath(`/projeler/${id}`);
    return { ok: true, message: "Tarihler teknik olarak onaylandı." };
  } catch (e) {
    return failure(e);
  }
}
