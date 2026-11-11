import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { audit } from "@/lib/audit";
import { notify } from "@/lib/notifications";
import { fullNameOf, normalizeEmail, normalizePhone, splitName } from "@/lib/normalize";
import type { Permission } from "@/lib/rbac/permissions";
import { SOURCE_LABELS } from "@/lib/labels";
import { findDuplicateCandidates, recordConsents, syncChannels } from "./contacts";
import { topPosition } from "./opportunities";
import { WEBSITE_SOURCE, type StoredWebsitePayload } from "@/lib/integrations/website-payload";

/** Web talebini otomatik atanacak kullanıcı (Ayarlar › Web talepleri). Boşsa yöneticilere bildirim gider. */
export const WEBSITE_OWNER_SETTING = "intake.website_owner_id";
/** Aynı müşterinin bu süre içinde güncellenmiş açık fırsatı varsa yeni fırsat açılmaz, talep ona eklenir. */
const OPEN_OPPORTUNITY_WINDOW_DAYS = 120;

/** Eşleşme taraması tüm müşteriler üzerinde yapılır (sistem işlemi); sonuç kullanıcıya gösterilmez. */
const SYSTEM_SCOPE = { id: "00000000-0000-0000-0000-000000000000", perms: new Set<Permission>(["contacts.view_all"]) };

export type WebsiteIngestOutcome = "converted_new_contact" | "converted_existing_contact" | "attached_open_opportunity" | "needs_review" | "already_processed";

async function activeUserId(id: string | null | undefined) {
  if (!id) return null;
  const u = await prisma.user.findFirst({ where: { id, status: "ACTIVE" }, select: { id: true } });
  return u?.id ?? null;
}

async function websiteOwnerId() {
  const s = await prisma.setting.findUnique({ where: { key: WEBSITE_OWNER_SETTING } });
  return activeUserId(typeof s?.value === "string" ? s.value : null);
}

async function managerIds() {
  const rows = await prisma.user.findMany({ where: { status: "ACTIVE", role: { in: ["SUPER_ADMIN", "MANAGER"] } }, select: { id: true } });
  return rows.map((r) => r.id);
}

function detailsText(p: StoredWebsitePayload) {
  return [
    p.message,
    p.topic ? `Konu: ${p.topic}` : null,
    p.productName ? `Ürün: ${p.productName}` : null,
    p.categoryName && !p.productName ? `Kategori: ${p.categoryName}` : null,
    p.selection ? `Seçim: ${p.selection}` : null,
    p.projectStage ? `Proje aşaması: ${p.projectStage}` : null,
    p.timeline ? `Zamanlama: ${p.timeline}` : null,
    p.sourcePath ? `Sayfa: ${p.sourcePath}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Worker işi (website.ingest): olaydaki web başvurusunu CRM kayıtlarına dönüştürür. İdempotent:
 * leads (source, sourceSubmissionId) tekil olduğundan aynı başvuru ikinci kez işlenmez.
 *
 * Eşleşme kuralı (sessiz birleştirme yok):
 *  - telefon/e-posta ile TEK müşteri eşleşirse talep o müşteriye bağlanır (açık fırsatı varsa ona eklenir),
 *  - birden fazla müşteri eşleşirse talep "Yeni" olarak bekletilir ve yöneticiye eşleşme kontrolü bildirilir,
 *  - eşleşme yoksa yeni müşteri + fırsat açılır.
 */
export async function ingestWebsiteEvent(eventId: string): Promise<{ leadId: string; outcome: WebsiteIngestOutcome }> {
  const ev = await prisma.integrationEvent.findUnique({ where: { id: eventId } });
  if (!ev || ev.provider !== "BIFIRE_WEBSITE") throw new Error(`Olay bulunamadı: ${eventId}`);
  const p = ev.payload as unknown as StoredWebsitePayload;
  const source = WEBSITE_SOURCE[p.formType];

  const done = await prisma.lead.findUnique({ where: { source_sourceSubmissionId: { source, sourceSubmissionId: p.submissionId } }, select: { id: true } });
  if (done) {
    await prisma.integrationEvent.update({ where: { id: ev.id }, data: { status: "SUCCESS", processedAt: new Date(), leadId: done.id } });
    return { leadId: done.id, outcome: "already_processed" };
  }

  const phone = normalizePhone(p.phone);
  const email = normalizeEmail(p.email);
  const candidates = phone || email ? await findDuplicateCandidates(SYSTEM_SCOPE, { phone, email }) : [];
  const configuredOwner = await websiteOwnerId();
  const managers = await managerIds();
  const now = new Date();
  const dueAt = new Date(now.getTime() + 24 * 3600_000);
  const label = SOURCE_LABELS[source];
  const details = detailsText(p);
  const consentSource = `website:${p.sourcePath ?? p.formType.toLowerCase()}`;
  const consentEvidence = { submissionId: p.submissionId, formType: p.formType, consentAt: p.consent.consentAt ?? p.submittedAt, noticeVersion: p.consent.noticeVersion, sourcePath: p.sourcePath } as Prisma.InputJsonValue;
  const leadBase = {
    source,
    sourceSubmissionId: p.submissionId,
    formType: p.formType.toLowerCase(),
    name: p.name,
    phone,
    email,
    district: p.district,
    message: details || null,
    payload: p as unknown as Prisma.InputJsonValue,
    receivedAt: new Date(p.submittedAt),
  };
  const fileRows = (extra: { leadId: string; contactId?: string; opportunityId?: string }) =>
    p.files.map((f) => ({ ...f, kind: f.mimeType.startsWith("image/") ? ("PHOTO" as const) : ("OTHER" as const), ...extra }));

  const result = await prisma.$transaction(async (t) => {
    // ── Birden çok eşleşme: insan kararı gerekir.
    if (candidates.length > 1) {
      const lead = await t.lead.create({ data: { ...leadBase, status: "RECEIVED" } });
      if (p.files.length) await t.attachment.createMany({ data: fileRows({ leadId: lead.id }) });
      await audit({ actorId: null, action: "lead_received", entityType: "lead", entityId: lead.id, summary: `${label}: birden çok müşteri eşleşti`, after: { candidates: candidates.map((c) => c.id) } }, t);
      for (const uid of new Set([configuredOwner, ...managers].filter((x): x is string => Boolean(x)))) {
        await notify({ userId: uid, type: "lead", title: `Web talebi eşleşme kontrolü bekliyor: ${p.name}`, body: "Telefon/e-posta birden fazla müşteriyle eşleşti. Doğru müşteriyi seçerek işleyin.", link: `/talepler/yeni?talep=${lead.id}`, dedupeKey: `lead:${lead.id}` }, t);
      }
      return { leadId: lead.id, outcome: "needs_review" as const };
    }

    // ── Müşteri: tek eşleşme → bağla, yoksa yeni.
    let contactId: string;
    let contactName: string;
    let contactOwner: string | null = null;
    const reused = candidates.length === 1;
    if (reused) {
      const c = await t.contact.findUniqueOrThrow({ where: { id: candidates[0].id }, select: { id: true, fullName: true, ownerId: true } });
      contactId = c.id;
      contactName = c.fullName;
      contactOwner = c.ownerId;
      // Yeni numara/e-posta varsa ikincil kanal olarak eklenir (birincil değişmez).
      if (phone) await t.contactChannel.upsert({ where: { contactId_type_normalized: { contactId, type: "PHONE", normalized: phone } }, create: { contactId, type: "PHONE", value: p.phone ?? phone, normalized: phone, isPrimary: false }, update: {} });
      if (email) await t.contactChannel.upsert({ where: { contactId_type_normalized: { contactId, type: "EMAIL", normalized: email } }, create: { contactId, type: "EMAIL", value: p.email ?? email, normalized: email, isPrimary: false }, update: {} });
    } else {
      const { firstName, lastName } = splitName(p.name);
      const c = await t.contact.create({
        data: {
          firstName,
          lastName,
          fullName: fullNameOf(firstName, lastName),
          primaryPhone: phone,
          primaryEmail: email,
          district: p.district,
          preferredChannel: "ANY",
          source,
          tags: [],
          ownerId: configuredOwner,
          kvkkNoticeAt: p.consent.kvkkAcknowledged ? new Date(p.consent.consentAt ?? p.submittedAt) : null,
          marketingConsent: false,
        },
      });
      await syncChannels(t, c.id, phone, email, p.phone, p.email);
      await t.activity.create({ data: { type: "SYSTEM", subject: `Müşteri kaydı oluşturuldu (${label})`, contactId: c.id } });
      await audit({ actorId: null, action: "contact_created", entityType: "contact", entityId: c.id, summary: `${c.fullName} (${label})` }, t);
      contactId = c.id;
      contactName = c.fullName;
    }
    await recordConsents(t, contactId, { kvkkNotice: p.consent.kvkkAcknowledged, marketingConsent: false }, consentSource, null, consentEvidence);

    const ownerId = configuredOwner ?? (await activeUserId(contactOwner));

    // ── Fırsat: aynı müşterinin yakın tarihli açık fırsatı varsa ona ekle.
    const open = reused
      ? await t.opportunity.findFirst({
          where: { contactId, deletedAt: null, stage: { notIn: ["WON", "LOST"] }, updatedAt: { gte: new Date(now.getTime() - OPEN_OPPORTUNITY_WINDOW_DAYS * 86400_000) } },
          orderBy: { updatedAt: "desc" },
          select: { id: true, title: true, ownerId: true },
        })
      : null;
    let opportunityId: string;
    let assignee = ownerId;
    if (open) {
      opportunityId = open.id;
      assignee = (await activeUserId(open.ownerId)) ?? ownerId;
      await t.opportunity.update({ where: { id: open.id }, data: { nextActionAt: dueAt, nextActionNote: "Yeni web talebi — dönüş yapın" } });
    } else {
      const title = [p.productName || p.topic || p.categoryName || "Şömine talebi", p.district].filter(Boolean).join(" · ").slice(0, 200);
      const o = await t.opportunity.create({
        data: {
          title,
          contactId,
          source,
          stage: "NEW",
          position: await topPosition(t, "NEW"),
          ownerId,
          productCategory: p.categoryName,
          productModel: p.productName,
          district: p.district,
          message: details || null,
          currency: "TRY",
          nextActionAt: dueAt,
          nextActionNote: "İlk dönüş",
        },
      });
      await t.opportunityStageHistory.create({ data: { opportunityId: o.id, toStage: "NEW" } });
      await t.activity.create({ data: { type: "SYSTEM", subject: `Fırsat açıldı: ${o.title}`, contactId, opportunityId: o.id } });
      await audit({ actorId: null, action: "opportunity_created", entityType: "opportunity", entityId: o.id, summary: `${o.title} (${label})` }, t);
      opportunityId = o.id;
    }

    const lead = await t.lead.create({ data: { ...leadBase, status: "CONVERTED", contactId, opportunityId, processedAt: now } });
    if (p.files.length) await t.attachment.createMany({ data: fileRows({ leadId: lead.id, contactId, opportunityId }) });
    await t.activity.create({
      data: { type: "SYSTEM", subject: `Web formu: ${label}`, body: details || null, contactId, opportunityId, metadata: { leadId: lead.id, submissionId: p.submissionId, files: p.files.length } as Prisma.InputJsonValue },
    });
    await t.task.create({
      data: {
        title: `${open ? "Yeni web talebi" : "İlk dönüş"}: ${contactName}`,
        description: `${label} üzerinden gelen talep. Müşteriye dönüş yapın ve ihtiyacı netleştirin.`,
        priority: "HIGH",
        dueAt,
        assigneeId: assignee,
        contactId,
        opportunityId,
      },
    });
    await audit({ actorId: null, action: "lead_converted", entityType: "lead", entityId: lead.id, summary: `${label}: ${p.name}`, after: { contactId, opportunityId, reusedContact: reused, attachedToOpen: Boolean(open) } }, t);

    const recipients = assignee ? [assignee] : managers;
    for (const uid of recipients) {
      await notify({ userId: uid, type: "lead", title: `Yeni web talebi: ${p.name}`, body: label, link: `/firsatlar/${opportunityId}`, dedupeKey: `lead:${lead.id}` }, t);
    }
    const outcome: WebsiteIngestOutcome = open ? "attached_open_opportunity" : reused ? "converted_existing_contact" : "converted_new_contact";
    return { leadId: lead.id, outcome };
  });

  await prisma.integrationEvent.update({ where: { id: ev.id }, data: { status: "SUCCESS", processedAt: new Date(), leadId: result.leadId } });
  return result;
}

/** Worker hata verdiğinde olayın durumunu da günceller (Entegrasyonlar ekranında görünür). */
export async function markWebsiteEventFailed(eventId: string, error: string, dead: boolean) {
  await prisma.integrationEvent.update({ where: { id: eventId }, data: { status: dead ? "DEAD_LETTER" : "RETRY", attempts: { increment: 1 }, lastError: error.slice(0, 2000) } }).catch(() => {});
  await prisma.integrationConnection.update({ where: { provider: "BIFIRE_WEBSITE" }, data: { lastErrorAt: new Date(), lastError: error.slice(0, 500) } }).catch(() => {});
}
