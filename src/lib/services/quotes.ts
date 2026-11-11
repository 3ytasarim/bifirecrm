import "server-only";
import { createHash, randomUUID } from "node:crypto";
import type { OpportunityStage, Prisma, QuoteStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { audit } from "@/lib/audit";
import { notify } from "@/lib/notifications";
import { assertCan, ForbiddenError, type Actor } from "@/lib/rbac/assert";
import { effectivePermissions } from "@/lib/rbac/permissions";
import { opportunityScope, quoteScope } from "@/lib/rbac/scope";
import { storage } from "@/lib/storage";
import { STAGE_LABELS, STAGE_ORDER } from "@/lib/labels";
import { code } from "@/lib/format";
import { formatPhone } from "@/lib/normalize";
import { calcQuote, fromScaled, toScaled, type ItemInput } from "@/lib/quotes/calc";
import { renderQuotePdf } from "@/lib/quotes/pdf";
import { RuleError } from "@/lib/errors";

type Tx = Prisma.TransactionClient;

/**
 * Teklif durum makinesi (onay olmadan müşteriye gönderilemez):
 *
 *   DRAFT ──gönder onaya──▶ PENDING_APPROVAL ──onay──▶ APPROVED ──gönderildi──▶ SENT ──▶ ACCEPTED | REJECTED
 *     ▲                         │ ret (not zorunlu)
 *     └─────────────────────────┘
 *   Kalemler yalnız DRAFT'ta düzenlenir. Onaylanmış/gönderilmiş teklif değiştirilemez; "Revize et" yeni sürüm (DRAFT) açar.
 *   Onaylayan, teklifi hazırlayan kişi olamaz (SUPER_ADMIN hariç: tek kişilik ekip için).
 */
export const QUOTE_PROFILE_SETTING = "quotes.profile";
export type QuoteProfile = { header: string; terms: string; validityDays: number };
const DEFAULT_PROFILE: QuoteProfile = { header: "Bifire Şömine", terms: "", validityDays: 15 };

export async function quoteProfile(): Promise<QuoteProfile> {
  const s = await prisma.setting.findUnique({ where: { key: QUOTE_PROFILE_SETTING } });
  const v = (s?.value ?? {}) as Partial<QuoteProfile>;
  return { header: v.header?.trim() || DEFAULT_PROFILE.header, terms: v.terms ?? "", validityDays: v.validityDays && v.validityDays > 0 ? v.validityDays : DEFAULT_PROFILE.validityDays };
}

async function loadQuote(actor: Actor, id: string, tx: Tx | typeof prisma = prisma) {
  const q = await tx.quote.findFirst({ where: { id, ...quoteScope(actor) }, include: { items: { orderBy: { position: "asc" } } } });
  if (!q) throw new ForbiddenError("Teklif bulunamadı ya da erişiminiz yok.");
  return q;
}

function requireStatus(status: QuoteStatus, allowed: QuoteStatus[], message: string) {
  if (!allowed.includes(status)) throw new RuleError(message);
}

/** Fırsat aşamasını yalnız İLERİ taşır (kazanıldı/kaybedildi'ye dokunmaz) ve geçmişe yazar. */
async function advanceOpportunity(t: Tx, opportunityId: string | null, to: OpportunityStage, actorId: string, note: string) {
  if (!opportunityId) return;
  const o = await t.opportunity.findUnique({ where: { id: opportunityId }, select: { stage: true, contactId: true } });
  if (!o || o.stage === "WON" || o.stage === "LOST") return;
  if (STAGE_ORDER.indexOf(o.stage) >= STAGE_ORDER.indexOf(to)) return;
  await t.opportunity.update({ where: { id: opportunityId }, data: { stage: to } });
  await t.opportunityStageHistory.create({ data: { opportunityId, fromStage: o.stage, toStage: to, changedById: actorId, note } });
  await t.activity.create({ data: { type: "STAGE_CHANGE", subject: `${STAGE_LABELS[o.stage]} → ${STAGE_LABELS[to]}`, body: note, actorId, contactId: o.contactId, opportunityId } });
}

/** Onay yetkisi olan aktif kullanıcılar (rol matrisi + yönetici değişiklikleri). */
async function approverIds(excludeId?: string) {
  const [users, overrides] = await Promise.all([
    prisma.user.findMany({ where: { status: "ACTIVE" }, select: { id: true, role: true } }),
    prisma.rolePermission.findMany({ select: { role: true, permission: true, granted: true } }),
  ]);
  return users.filter((u) => u.id !== excludeId && effectivePermissions(u.role, overrides).has("quotes.approve")).map((u) => u.id);
}

export async function createQuote(actor: Actor, opportunityId: string) {
  assertCan(actor, "quotes.create");
  const profile = await quoteProfile();
  return prisma.$transaction(async (t) => {
    const o = await t.opportunity.findFirst({ where: { id: opportunityId, ...opportunityScope(actor) }, select: { id: true, contactId: true, currency: true, title: true } });
    if (!o) throw new ForbiddenError("Fırsat bulunamadı ya da erişiminiz yok.");
    const validUntil = new Date(Date.now() + profile.validityDays * 86400_000);
    validUntil.setUTCHours(0, 0, 0, 0);
    const q = await t.quote.create({ data: { contactId: o.contactId, opportunityId: o.id, currency: o.currency, validUntil, terms: profile.terms || null, createdById: actor.id } });
    await t.quote.update({ where: { id: q.id }, data: { rootId: q.id } });
    await advanceOpportunity(t, o.id, "QUOTATION_PREPARING", actor.id, `${code.quote(q.number)} hazırlanıyor`);
    await audit({ actorId: actor.id, action: "quote_created", entityType: "quote", entityId: q.id, summary: `${code.quote(q.number)} · ${o.title}` }, t);
    return q;
  });
}

export type QuoteDraftInput = { currency: string; validUntil: Date | null; notes: string | null; terms: string | null; items: (ItemInput & { description: string; unit: string })[] };

export async function saveQuoteDraft(actor: Actor, id: string, input: QuoteDraftInput) {
  assertCan(actor, "quotes.create");
  const totals = calcQuote(input.items);
  return prisma.$transaction(async (t) => {
    const q = await loadQuote(actor, id, t);
    requireStatus(q.status, ["DRAFT"], "Yalnız taslak teklif düzenlenebilir. Onaylanan/gönderilen teklif için “Revize et” ile yeni sürüm açın.");
    await t.quoteItem.deleteMany({ where: { quoteId: id } });
    if (input.items.length) {
      await t.quoteItem.createMany({
        data: input.items.map((it, i) => ({
          quoteId: id,
          position: i,
          description: it.description,
          // Kullanıcı biçimi ("1.234,56") → DB ondalığı ("1234.56"); hesapla aynı ayrıştırıcı.
          quantity: fromScaled(toScaled(it.quantity, 3), 3),
          unit: it.unit,
          unitPrice: fromScaled(toScaled(it.unitPrice, 2), 2),
          discountPct: fromScaled(toScaled(it.discountPct, 2), 2),
          taxPct: fromScaled(toScaled(it.taxPct, 2), 2),
          lineTotal: totals.items[i].net,
        })),
      });
    }
    const updated = await t.quote.update({
      where: { id },
      data: { currency: input.currency, validUntil: input.validUntil, notes: input.notes, terms: input.terms, subtotal: totals.subtotal, discountTotal: totals.discountTotal, taxTotal: totals.taxTotal, grandTotal: totals.grandTotal },
    });
    await audit({ actorId: actor.id, action: "quote_updated", entityType: "quote", entityId: id, summary: code.quote(q.number), before: { grandTotal: q.grandTotal.toString(), items: q.items.length }, after: { grandTotal: totals.grandTotal, items: input.items.length } }, t);
    return updated;
  });
}

export async function submitQuote(actor: Actor, id: string) {
  assertCan(actor, "quotes.create");
  const result = await prisma.$transaction(async (t) => {
    const q = await loadQuote(actor, id, t);
    requireStatus(q.status, ["DRAFT"], "Yalnız taslak teklif onaya gönderilebilir.");
    if (!q.items.length) throw new RuleError("Onaya göndermeden önce en az bir kalem ekleyin.");
    if (!q.validUntil) throw new RuleError("Geçerlilik tarihi zorunlu.");
    await t.quote.update({ where: { id }, data: { status: "PENDING_APPROVAL" } });
    await audit({ actorId: actor.id, action: "quote_submitted", entityType: "quote", entityId: id, summary: code.quote(q.number) }, t);
    return q;
  });
  for (const uid of await approverIds(actor.id)) {
    await notify({ userId: uid, type: "quote", title: `Onay bekleyen teklif: ${code.quote(result.number)}`, link: `/teklifler/${id}`, dedupeKey: `quote-approval:${id}:${result.updatedAt.getTime()}` });
  }
}

export async function decideQuote(actor: Actor, id: string, decision: "APPROVED" | "REJECTED", note: string | null) {
  assertCan(actor, "quotes.approve");
  if (decision === "REJECTED" && !note?.trim()) throw new RuleError("Ret gerekçesi zorunlu.");
  return prisma.$transaction(async (t) => {
    const q = await loadQuote(actor, id, t);
    requireStatus(q.status, ["PENDING_APPROVAL"], "Yalnız onay bekleyen teklif onaylanabilir/reddedilebilir.");
    if (q.createdById === actor.id && actor.role !== "SUPER_ADMIN") throw new ForbiddenError("Kendi hazırladığınız teklifi onaylayamazsınız.");
    await t.quoteApproval.create({ data: { quoteId: id, decision, approverId: actor.id, note: note?.trim() || null } });
    await t.quote.update({ where: { id }, data: { status: decision === "APPROVED" ? "APPROVED" : "DRAFT" } });
    await audit({ actorId: actor.id, action: "quote_approval", entityType: "quote", entityId: id, summary: `${code.quote(q.number)}: ${decision === "APPROVED" ? "onaylandı" : "reddedildi"}`, after: { decision, note: note?.trim() || null } }, t);
    if (q.createdById && q.createdById !== actor.id) {
      await notify({ userId: q.createdById, type: "quote", title: `${code.quote(q.number)} ${decision === "APPROVED" ? "onaylandı — gönderilebilir" : "reddedildi — düzeltme gerekli"}`, body: note ?? undefined, link: `/teklifler/${id}` }, t);
    }
  });
}

/** PDF verisi (önizleme ve gönderim aynı kaynaktan). */
export async function quotePdfInput(id: string, watermark: string | null) {
  const q = await prisma.quote.findUniqueOrThrow({
    where: { id },
    include: {
      items: { orderBy: { position: "asc" } },
      contact: { select: { fullName: true, primaryPhone: true, primaryEmail: true, address: true, district: true, city: true, organization: { select: { name: true } } } },
      opportunity: { select: { title: true } },
    },
  });
  const [profile, creator] = await Promise.all([quoteProfile(), q.createdById ? prisma.user.findUnique({ where: { id: q.createdById }, select: { name: true, phone: true, email: true } }) : null]);
  const c = q.contact;
  return {
    q,
    input: {
      code: code.quote(q.number),
      version: q.version,
      status: q.status,
      watermark,
      issuedAt: q.sentAt ?? new Date(),
      validUntil: q.validUntil,
      currency: q.currency,
      company: profile.header.split(/\r?\n/).map((l) => l.trim()).filter(Boolean),
      customer: {
        name: c.organization?.name ? `${c.organization.name} — ${c.fullName}` : c.fullName,
        lines: [c.address, [c.district, c.city].filter(Boolean).join(" / "), formatPhone(c.primaryPhone), c.primaryEmail].filter((x): x is string => Boolean(x && x.trim())),
      },
      opportunityTitle: q.opportunity?.title ?? null,
      items: q.items.map((i) => ({ description: i.description, quantity: i.quantity.toString(), unit: i.unit, unitPrice: i.unitPrice.toString(), discountPct: i.discountPct.toString(), taxPct: i.taxPct.toString() })),
      stored: { subtotal: q.subtotal.toString(), discountTotal: q.discountTotal.toString(), taxTotal: q.taxTotal.toString(), grandTotal: q.grandTotal.toString() },
      notes: q.notes,
      terms: q.terms,
      preparedBy: creator ? [creator.name, formatPhone(creator.phone), creator.email].filter(Boolean).join(" · ") : null,
    },
  };
}

/**
 * Onaylı teklifi "gönderildi" yapar: değişmez PDF üretip özel depoya yazar (fırsat/müşteri dosyalarına eklenir),
 * fırsatı "Teklif gönderildi" aşamasına taşır. Müşteriye e-posta/WhatsApp ile otomatik gönderim YOKTUR (kanal bağlı değil);
 * kullanıcı PDF'i kendisi iletir.
 */
export async function markQuoteSent(actor: Actor, id: string) {
  assertCan(actor, "quotes.send");
  const q0 = await loadQuote(actor, id);
  requireStatus(q0.status, ["APPROVED"], "Teklif onaylanmadan gönderildi olarak işaretlenemez.");
  const approved = await prisma.quoteApproval.findFirst({ where: { quoteId: id }, orderBy: { createdAt: "desc" } });
  if (approved?.decision !== "APPROVED") throw new RuleError("Teklif onaylanmadan gönderildi olarak işaretlenemez.");

  const sentAt = new Date();
  const { q, input } = await quotePdfInput(id, null);
  const pdf = await renderQuotePdf({ ...input, issuedAt: sentAt });
  const now = new Date();
  const storageKey = `files/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, "0")}/${randomUUID()}.pdf`;
  const s = await storage();
  await s.put(storageKey, pdf, "application/pdf");
  try {
    await prisma.$transaction(async (t) => {
      // Yarış koruması: bu arada durum değiştiyse geri al.
      const n = await t.quote.updateMany({ where: { id, status: "APPROVED" }, data: { status: "SENT", sentAt } });
      if (n.count !== 1) throw new RuleError("Teklifin durumu değişti; sayfayı yenileyin.");
      const att = await t.attachment.create({
        data: {
          storageKey,
          originalName: `Teklif-${code.quote(q.number)}${q.version > 1 ? `-s${q.version}` : ""}.pdf`,
          mimeType: "application/pdf",
          sizeBytes: pdf.length,
          checksumSha256: createHash("sha256").update(pdf).digest("hex"),
          kind: "QUOTE",
          scanStatus: "CLEAN",
          uploadedById: actor.id,
          contactId: q.contactId,
          opportunityId: q.opportunityId,
        },
      });
      await t.quote.update({ where: { id }, data: { pdfAttachmentId: att.id } });
      await advanceOpportunity(t, q.opportunityId, "QUOTATION_SENT", actor.id, `${code.quote(q.number)} gönderildi`);
      await t.activity.create({ data: { type: "FILE", subject: `Teklif gönderildi: ${code.quote(q.number)}`, body: `Genel toplam ${q.grandTotal.toString()} ${q.currency}`, actorId: actor.id, contactId: q.contactId, opportunityId: q.opportunityId } });
      await audit({ actorId: actor.id, action: "quote_sent", entityType: "quote", entityId: id, summary: code.quote(q.number), after: { grandTotal: q.grandTotal.toString(), pdf: att.id } }, t);
    });
  } catch (e) {
    await s.delete(storageKey).catch(() => {});
    throw e;
  }
}

export async function recordCustomerResponse(actor: Actor, id: string, response: "ACCEPTED" | "REJECTED", note: string | null) {
  assertCan(actor, "quotes.send");
  return prisma.$transaction(async (t) => {
    const q = await loadQuote(actor, id, t);
    requireStatus(q.status, ["SENT"], "Müşteri yanıtı yalnız gönderilmiş teklif için girilir.");
    await t.quote.update({ where: { id }, data: { status: response } });
    if (response === "ACCEPTED") await advanceOpportunity(t, q.opportunityId, "NEGOTIATION", actor.id, `${code.quote(q.number)} müşteri tarafından kabul edildi`);
    await t.activity.create({ data: { type: "SYSTEM", subject: `Teklif ${response === "ACCEPTED" ? "kabul edildi" : "reddedildi"}: ${code.quote(q.number)}`, body: note, actorId: actor.id, contactId: q.contactId, opportunityId: q.opportunityId } });
    await audit({ actorId: actor.id, action: "quote_response", entityType: "quote", entityId: id, summary: `${code.quote(q.number)}: ${response}`, after: { note } }, t);
  });
}

/** Yeni sürüm: kalemler kopyalanır, eski sürüm olduğu gibi kalır (gönderilmiş PDF değişmez). */
export async function reviseQuote(actor: Actor, id: string) {
  assertCan(actor, "quotes.create");
  return prisma.$transaction(async (t) => {
    const q = await loadQuote(actor, id, t);
    requireStatus(q.status, ["APPROVED", "SENT", "REJECTED", "PENDING_APPROVAL"], "Taslak teklif zaten düzenlenebilir.");
    const rootId = q.rootId ?? q.id;
    const openDraft = await t.quote.findFirst({ where: { rootId, status: "DRAFT", deletedAt: null }, select: { id: true } });
    if (openDraft) throw new RuleError("Bu teklifin zaten açık bir taslak sürümü var.");
    const last = await t.quote.aggregate({ where: { rootId }, _max: { version: true } });
    const profile = await quoteProfile();
    const validUntil = new Date(Date.now() + profile.validityDays * 86400_000);
    validUntil.setUTCHours(0, 0, 0, 0);
    const n = await t.quote.create({
      data: {
        rootId,
        version: (last._max.version ?? q.version) + 1,
        contactId: q.contactId,
        opportunityId: q.opportunityId,
        projectId: q.projectId,
        currency: q.currency,
        subtotal: q.subtotal,
        discountTotal: q.discountTotal,
        taxTotal: q.taxTotal,
        grandTotal: q.grandTotal,
        validUntil,
        notes: q.notes,
        terms: q.terms,
        createdById: actor.id,
        items: { create: q.items.map(({ position, description, quantity, unit, unitPrice, discountPct, taxPct, lineTotal }) => ({ position, description, quantity, unit, unitPrice, discountPct, taxPct, lineTotal })) },
      },
    });
    // Onay bekleyen eski sürüm geri çekilir (iki sürüm aynı anda onayda olmasın).
    if (q.status === "PENDING_APPROVAL") await t.quote.update({ where: { id }, data: { status: "DRAFT", deletedAt: new Date() } });
    await audit({ actorId: actor.id, action: "quote_revised", entityType: "quote", entityId: n.id, summary: `${code.quote(q.number)} → ${code.quote(n.number)} (sürüm ${n.version})` }, t);
    return n;
  });
}

export async function deleteDraftQuote(actor: Actor, id: string) {
  assertCan(actor, "quotes.create");
  return prisma.$transaction(async (t) => {
    const q = await loadQuote(actor, id, t);
    requireStatus(q.status, ["DRAFT"], "Yalnız taslak teklif silinebilir.");
    await t.quote.update({ where: { id }, data: { deletedAt: new Date() } });
    await audit({ actorId: actor.id, action: "quote_deleted", entityType: "quote", entityId: id, summary: code.quote(q.number) }, t);
    return q;
  });
}
