"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { LeadSource, PreferredChannel } from "@prisma/client";
import { failure, fieldErrors, formObject, zCheckbox, zOptional, zUuidOpt, type ActionState } from "@/lib/action";
import { getActorOrNull } from "@/lib/rbac/guard";
import { normalizeEmail, normalizePhone, parseTags } from "@/lib/normalize";
import { archiveContact, createContact, findDuplicateCandidates, mergeContacts, updateContact } from "@/lib/services/contacts";

const schema = z
  .object({
    firstName: z.string().trim().min(1, "Ad zorunlu.").max(80),
    lastName: zOptional(80),
    title: zOptional(80),
    organizationName: zOptional(160),
    phone: zOptional(40),
    email: zOptional(160),
    city: zOptional(60),
    district: zOptional(60),
    address: zOptional(400),
    preferredChannel: z.enum(PreferredChannel),
    source: z.enum(LeadSource),
    tags: z
      .string()
      .optional()
      .transform((v) => parseTags(v)),
    notes: zOptional(4000),
    ownerId: zUuidOpt,
    kvkkNotice: zCheckbox,
    marketingConsent: zCheckbox,
    confirmNew: zCheckbox,
  })
  .superRefine((v, ctx) => {
    if (v.phone && !normalizePhone(v.phone)) ctx.addIssue({ code: "custom", path: ["phone"], message: "Geçerli bir telefon numarası yazın." });
    if (v.email && !normalizeEmail(v.email)) ctx.addIssue({ code: "custom", path: ["email"], message: "Geçerli bir e-posta adresi yazın." });
  });

const NO_SESSION: ActionState = { ok: false, message: "Oturumunuz sona erdi. Lütfen yeniden giriş yapın." };

export async function createContactAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await getActorOrNull();
  if (!actor) return NO_SESSION;
  const parsed = schema.safeParse(formObject(fd));
  if (!parsed.success) return { ok: false, errors: fieldErrors(parsed.error), message: "Lütfen işaretli alanları düzeltin." };
  try {
    if (!parsed.data.confirmNew) {
      const candidates = await findDuplicateCandidates(actor, { phone: parsed.data.phone, email: parsed.data.email });
      if (candidates.length) {
        return { ok: false, message: "Bu telefon/e-posta ile kayıtlı müşteri var. Aynı kişiyse mevcut kaydı kullanın; farklı kişiyse onay kutusunu işaretleyip tekrar kaydedin.", data: { candidates } };
      }
    }
    if (parsed.data.ownerId && parsed.data.ownerId !== actor.id && !actor.perms.has("opportunities.assign")) parsed.data.ownerId = actor.id;
    const c = await createContact(actor, parsed.data);
    revalidatePath("/musteriler");
    return { ok: true, message: "Müşteri oluşturuldu.", redirectTo: `/musteriler/${c.id}` };
  } catch (e) {
    return failure(e);
  }
}

export async function updateContactAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await getActorOrNull();
  if (!actor) return NO_SESSION;
  const id = String(fd.get("id"));
  const parsed = schema.safeParse(formObject(fd));
  if (!parsed.success) return { ok: false, errors: fieldErrors(parsed.error), message: "Lütfen işaretli alanları düzeltin." };
  try {
    if (parsed.data.ownerId && !actor.perms.has("opportunities.assign")) parsed.data.ownerId = null;
    const candidates = await findDuplicateCandidates(actor, { phone: parsed.data.phone, email: parsed.data.email }, id);
    await updateContact(actor, id, parsed.data);
    revalidatePath(`/musteriler/${id}`);
    return {
      ok: true,
      message: candidates.length ? `Kaydedildi. Uyarı: aynı telefon/e-posta ${candidates.length} başka kayıtta da var — gerekiyorsa birleştirin.` : "Kaydedildi.",
      redirectTo: `/musteriler/${id}`,
    };
  } catch (e) {
    return failure(e);
  }
}

export async function archiveContactAction(fd: FormData) {
  const actor = await getActorOrNull();
  if (!actor) return;
  await archiveContact(actor, String(fd.get("id")));
  revalidatePath("/musteriler");
  redirect("/musteriler");
}

export async function mergeAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await getActorOrNull();
  if (!actor) return NO_SESSION;
  const winnerId = String(fd.get("winnerId") ?? "");
  const loserId = String(fd.get("loserId") ?? "");
  if (fd.get("confirm") !== "on") return { ok: false, errors: { confirm: "Birleştirmeyi onaylayın." } };
  if (!winnerId || !loserId) return { ok: false, message: "İki kayıt seçin." };
  try {
    const r = await mergeContacts(actor, winnerId, loserId);
    revalidatePath("/musteriler");
    return { ok: true, message: "Kayıtlar birleştirildi.", redirectTo: `/musteriler/${r.winnerId}` };
  } catch (e) {
    return failure(e);
  }
}
