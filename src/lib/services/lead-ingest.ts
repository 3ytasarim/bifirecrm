import "server-only";
import type { LeadSource, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { audit } from "@/lib/audit";
import { notify } from "@/lib/notifications";
import { fullNameOf, normalizeEmail, normalizePhone, splitName } from "@/lib/normalize";
import type { Permission } from "@/lib/rbac/permissions";
import { SOURCE_LABELS } from "@/lib/labels";
import { findDuplicateCandidates, recordConsents, syncChannels } from "./contacts";
import { topPosition } from "./opportunities";
import type { StoredWebsitePayload } from "@/lib/integrations/website-payload";

/** Dış kaynaklı talepleri otomatik atanacak kullanıcı (Ayarlar › Web talepleri). Boşsa yöneticilere bildirim gider. */
export const WEBSITE_OWNER_SETTING = "intake.website_owner_id";
/** Aynı müşterinin bu süre içinde güncellenmiş açık fırsatı varsa yeni fırsat açılmaz, talep ona eklenir. */
const OPEN_OPPORTUNITY_WINDOW_DAYS = 120;

/** Eşleşme taraması tüm müşteriler üzerinde yapılır (sistem işlemi); sonuç kullanıcıya gösterilmez. */
const SYSTEM_SCOPE = { id: "00000000-0000-0000-0000-000000000000", perms: new Set<Permission>(["contacts.view_all"]) };

export type IngestOutcome = "converted_new_contact" | "converted_existing_contact" | "attached_open_opportunity" | "needs_review" | "already_processed";

export type InboundFile = StoredWebsitePayload["files"][number];

/** Kaynaktan bağımsız gelen talep (web formu, Meta reklam formu …). */
export type InboundLead = {
  source: LeadSource;
  /** Kaynağın gönderim kimliği; (source, submissionId) tekil → aynı talep iki kez işlenmez. */
  submissionId: string;
  formType: string;
  name: string;
  phone: string | null;
  email: string | null;
  city?: string | null;
  district: string | null;
  details: string;
  /** Fırsat başlığı için (ürün / konu / kategori). */
  titleHint: string | null;
  productCategory?: string | null;
  productModel?: string | null;
  payload: Prisma.InputJsonValue;
  receivedAt: Date;
  /** KVKK aydınlatması kaynağında gösterildi mi + kanıtı. Kanıt yoksa false (varsayım yapılmaz). */
  consent: { kvkkNotice: boolean; noticeAt: Date | null; source: string; evidence: Prisma.InputJsonValue | null };
  files?: InboundFile[];
};

async function activeUserId(id: string | null | undefined) {
  if (!id) return null;
  const u = await prisma.user.findFirst({ where: { id, status: "ACTIVE" }, select: { id: true } });
  return u?.id ?? null;
}

export async function inboundOwnerId() {
  const s = await prisma.setting.findUnique({ where: { key: WEBSITE_OWNER_SETTING } });
  return activeUserId(typeof s?.value === "string" ? s.value : null);
}

export async function managerIds() {
  const rows = await prisma.user.findMany({ where: { status: "ACTIVE", role: { in: ["SUPER_ADMIN", "MANAGER"] } }, select: { id: true } });
  return rows.map((r) => r.id);
}

/**
 * Gelen talebi CRM kayıtlarına dönüştürür. İdempotent: leads (source, sourceSubmissionId) tekil.
 *
 * Eşleşme kuralı (sessiz birleştirme yok):
 *  - telefon/e-posta ile TEK müşteri eşleşirse talep o müşteriye bağlanır (açık fırsatı varsa ona eklenir),
 *  - birden fazla müşteri eşleşirse talep "Yeni" olarak bekletilir ve yöneticiye eşleşme kontrolü bildirilir,
 *  - eşleşme yoksa yeni müşteri + fırsat açılır.
 */
export async function ingestInboundLead(input: InboundLead): Promise<{ leadId: string; outcome: IngestOutcome }> {
  const { source } = input;
  const done = await prisma.lead.findUnique({ where: { source_sourceSubmissionId: { source, sourceSubmissionId: input.submissionId } }, select: { id: true } });
  if (done) return { leadId: done.id, outcome: "already_processed" };

  const phone = normalizePhone(input.phone);
  const email = normalizeEmail(input.email);
  const files = input.files ?? [];
  const candidates = phone || email ? await findDuplicateCandidates(SYSTEM_SCOPE, { phone, email }) : [];
  const configuredOwner = await inboundOwnerId();
  const managers = await managerIds();
  const now = new Date();
  const dueAt = new Date(now.getTime() + 24 * 3600_000);
  const label = SOURCE_LABELS[source];
  const leadBase = {
    source,
    sourceSubmissionId: input.submissionId,
    formType: input.formType,
    name: input.name,
    phone,
    email,
    city: input.city ?? null,
    district: input.district,
    message: input.details || null,
    payload: input.payload,
    receivedAt: input.receivedAt,
  };
  const fileRows = (extra: { leadId: string; contactId?: string; opportunityId?: string }) =>
    files.map((f) => ({ ...f, kind: f.mimeType.startsWith("image/") ? ("PHOTO" as const) : ("OTHER" as const), ...extra }));

  return prisma.$transaction(async (t) => {
    // ── Birden çok eşleşme: insan kararı gerekir.
    if (candidates.length > 1) {
      const lead = await t.lead.create({ data: { ...leadBase, status: "RECEIVED" } });
      if (files.length) await t.attachment.createMany({ data: fileRows({ leadId: lead.id }) });
      await audit({ actorId: null, action: "lead_received", entityType: "lead", entityId: lead.id, summary: `${label}: birden çok müşteri eşleşti`, after: { candidates: candidates.map((c) => c.id) } }, t);
      for (const uid of new Set([configuredOwner, ...managers].filter((x): x is string => Boolean(x)))) {
        await notify({ userId: uid, type: "lead", title: `Talep eşleşme kontrolü bekliyor: ${input.name}`, body: `${label} · telefon/e-posta birden fazla müşteriyle eşleşti. Doğru müşteriyi seçerek işleyin.`, link: `/talepler/yeni?talep=${lead.id}`, dedupeKey: `lead:${lead.id}` }, t);
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
      if (phone) await t.contactChannel.upsert({ where: { contactId_type_normalized: { contactId, type: "PHONE", normalized: phone } }, create: { contactId, type: "PHONE", value: input.phone ?? phone, normalized: phone, isPrimary: false }, update: {} });
      if (email) await t.contactChannel.upsert({ where: { contactId_type_normalized: { contactId, type: "EMAIL", normalized: email } }, create: { contactId, type: "EMAIL", value: input.email ?? email, normalized: email, isPrimary: false }, update: {} });
    } else {
      const { firstName, lastName } = splitName(input.name);
      const c = await t.contact.create({
        data: {
          firstName,
          lastName,
          fullName: fullNameOf(firstName, lastName),
          primaryPhone: phone,
          primaryEmail: email,
          city: input.city ?? null,
          district: input.district,
          preferredChannel: "ANY",
          source,
          tags: [],
          ownerId: configuredOwner,
          kvkkNoticeAt: input.consent.kvkkNotice ? input.consent.noticeAt : null,
          marketingConsent: false,
        },
      });
      await syncChannels(t, c.id, phone, email, input.phone, input.email);
      await t.activity.create({ data: { type: "SYSTEM", subject: `Müşteri kaydı oluşturuldu (${label})`, contactId: c.id } });
      await audit({ actorId: null, action: "contact_created", entityType: "contact", entityId: c.id, summary: `${c.fullName} (${label})` }, t);
      contactId = c.id;
      contactName = c.fullName;
    }
    if (input.consent.kvkkNotice) {
      await recordConsents(t, contactId, { kvkkNotice: true, marketingConsent: false }, input.consent.source, null, input.consent.evidence ?? undefined);
    }

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
      await t.opportunity.update({ where: { id: open.id }, data: { nextActionAt: dueAt, nextActionNote: `Yeni talep (${label}) — dönüş yapın` } });
    } else {
      const title = [input.titleHint || "Şömine talebi", input.district].filter(Boolean).join(" · ").slice(0, 200);
      const o = await t.opportunity.create({
        data: {
          title,
          contactId,
          source,
          stage: "NEW",
          position: await topPosition(t, "NEW"),
          ownerId,
          productCategory: input.productCategory ?? null,
          productModel: input.productModel ?? null,
          city: input.city ?? null,
          district: input.district,
          message: input.details || null,
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
    if (files.length) await t.attachment.createMany({ data: fileRows({ leadId: lead.id, contactId, opportunityId }) });
    await t.activity.create({
      data: { type: "SYSTEM", subject: `Gelen talep: ${label}`, body: input.details || null, contactId, opportunityId, metadata: { leadId: lead.id, submissionId: input.submissionId, files: files.length } as Prisma.InputJsonValue },
    });
    await t.task.create({
      data: {
        title: `${open ? "Yeni talep" : "İlk dönüş"}: ${contactName}`,
        description: `${label} üzerinden gelen talep. Müşteriye dönüş yapın ve ihtiyacı netleştirin.`,
        priority: "HIGH",
        dueAt,
        assigneeId: assignee,
        contactId,
        opportunityId,
      },
    });
    await audit({ actorId: null, action: "lead_converted", entityType: "lead", entityId: lead.id, summary: `${label}: ${input.name}`, after: { contactId, opportunityId, reusedContact: reused, attachedToOpen: Boolean(open) } }, t);

    const recipients = assignee ? [assignee] : managers;
    for (const uid of recipients) {
      await notify({ userId: uid, type: "lead", title: `Yeni talep: ${input.name}`, body: label, link: `/firsatlar/${opportunityId}`, dedupeKey: `lead:${lead.id}` }, t);
    }
    const outcome: IngestOutcome = open ? "attached_open_opportunity" : reused ? "converted_existing_contact" : "converted_new_contact";
    return { leadId: lead.id, outcome };
  });
}
