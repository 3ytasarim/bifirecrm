"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { failure, type ActionState } from "@/lib/action";
import { parseDateOnly } from "@/lib/format";
import { getActorOrNull } from "@/lib/rbac/guard";
import { calcItem } from "@/lib/quotes/calc";
import { createQuote, decideQuote, deleteDraftQuote, markQuoteSent, recordCustomerResponse, reviseQuote, saveQuoteDraft, submitQuote } from "@/lib/services/quotes";

const NO_SESSION: ActionState = { ok: false, message: "Oturumunuz sona erdi. Lütfen yeniden giriş yapın." };
const uuid = z.string().regex(/^[0-9a-f-]{36}$/i, "Geçersiz kayıt.");

const itemSchema = z.object({
  description: z.string().trim().min(1, "Açıklama yazın.").max(1000),
  quantity: z.string().trim().min(1, "Miktar yazın."),
  unit: z.string().trim().min(1).max(20),
  unitPrice: z.string().trim().min(1, "Birim fiyat yazın."),
  discountPct: z.string().trim().default("0"),
  taxPct: z.string().trim().default("20"),
});

const draftSchema = z.object({
  id: uuid,
  currency: z.enum(["TRY", "EUR", "USD"]),
  validUntil: z.string().refine((v) => parseDateOnly(v) !== null, "Geçerlilik tarihi seçin."),
  notes: z.string().trim().max(4000).transform((v) => v || null),
  terms: z.string().trim().max(8000).transform((v) => v || null),
  items: z.string().transform((v, ctx) => {
    try {
      return z.array(itemSchema).max(100, "En fazla 100 kalem.").parse(JSON.parse(v));
    } catch (e) {
      ctx.addIssue({ code: "custom", message: e instanceof z.ZodError ? (e.issues[0]?.message ?? "Kalemler geçersiz.") : "Kalemler geçersiz." });
      return z.NEVER;
    }
  }),
});

/** Yeni teklif (fırsattan). Başarıda teklif sayfasına gider. */
export async function createQuoteAction(fd: FormData) {
  const actor = await getActorOrNull();
  if (!actor) redirect("/giris");
  const opportunityId = uuid.parse(String(fd.get("opportunityId")));
  const q = await createQuote(actor, opportunityId);
  redirect(`/teklifler/${q.id}`);
}

export async function saveQuoteAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await getActorOrNull();
  if (!actor) return NO_SESSION;
  const parsed = draftSchema.safeParse(Object.fromEntries(["id", "currency", "validUntil", "notes", "terms", "items"].map((k) => [k, String(fd.get(k) ?? "")])));
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Lütfen alanları kontrol edin." };
  const d = parsed.data;
  // Satır bazında sayı doğrulaması: hangi satırda sorun olduğunu söyle.
  for (const [i, it] of d.items.entries()) {
    try {
      calcItem(it);
    } catch (e) {
      return { ok: false, message: `${i + 1}. kalem: ${e instanceof Error ? e.message : "geçersiz değer"}` };
    }
  }
  try {
    await saveQuoteDraft(actor, d.id, { currency: d.currency, validUntil: parseDateOnly(d.validUntil), notes: d.notes, terms: d.terms, items: d.items });
    revalidatePath(`/teklifler/${d.id}`);
    return { ok: true, message: "Teklif kaydedildi." };
  } catch (e) {
    return failure(e);
  }
}

async function run(fd: FormData, fn: (actorId: NonNullable<Awaited<ReturnType<typeof getActorOrNull>>>, id: string) => Promise<unknown>, ok: string): Promise<ActionState> {
  const actor = await getActorOrNull();
  if (!actor) return NO_SESSION;
  const id = uuid.safeParse(String(fd.get("id")));
  if (!id.success) return { ok: false, message: "Geçersiz kayıt." };
  try {
    const r = await fn(actor, id.data);
    revalidatePath(`/teklifler/${id.data}`);
    revalidatePath("/teklifler");
    const redirectTo = r && typeof r === "object" && "id" in r && typeof r.id === "string" && r.id !== id.data ? `/teklifler/${r.id}` : undefined;
    return { ok: true, message: ok, redirectTo };
  } catch (e) {
    return failure(e);
  }
}

export async function submitQuoteAction(_: ActionState, fd: FormData) {
  return run(fd, (a, id) => submitQuote(a, id), "Teklif onaya gönderildi.");
}

export async function decideQuoteAction(_: ActionState, fd: FormData) {
  const decision = fd.get("decision") === "APPROVED" ? "APPROVED" : "REJECTED";
  const note = String(fd.get("note") ?? "").slice(0, 2000) || null;
  return run(fd, (a, id) => decideQuote(a, id, decision, note), decision === "APPROVED" ? "Teklif onaylandı." : "Teklif reddedildi; hazırlayana bildirildi.");
}

export async function markSentAction(_: ActionState, fd: FormData) {
  return run(fd, (a, id) => markQuoteSent(a, id), "Teklif gönderildi olarak işaretlendi; PDF fırsat dosyalarına eklendi.");
}

export async function customerResponseAction(_: ActionState, fd: FormData) {
  const response = fd.get("response") === "ACCEPTED" ? "ACCEPTED" : "REJECTED";
  const note = String(fd.get("note") ?? "").slice(0, 2000) || null;
  return run(fd, (a, id) => recordCustomerResponse(a, id, response, note), "Müşteri yanıtı kaydedildi.");
}

export async function reviseQuoteAction(_: ActionState, fd: FormData) {
  return run(fd, (a, id) => reviseQuote(a, id), "Yeni sürüm açıldı.");
}

export async function deleteDraftAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = await run(fd, (a, id) => deleteDraftQuote(a, id), "Taslak silindi.");
  return r.ok ? { ...r, redirectTo: "/teklifler" } : r;
}
