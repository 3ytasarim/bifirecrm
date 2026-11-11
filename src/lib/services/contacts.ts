import "server-only";
import type { LeadSource, PreferredChannel, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { audit, diff, redact } from "@/lib/audit";
import { fullNameOf, normalizeEmail, normalizePhone } from "@/lib/normalize";
import { assertCan, type Actor } from "@/lib/rbac/assert";
import { contactScope } from "@/lib/rbac/scope";

type Tx = Prisma.TransactionClient;

export type DuplicateCandidate = {
  id: string;
  number: number;
  fullName: string;
  primaryPhone: string | null;
  primaryEmail: string | null;
  city: string | null;
  district: string | null;
  matchedOn: ("phone" | "email")[];
  visible: boolean;
};

/**
 * Telefon (E.164) veya e-posta eşleşen müşteri adayları. Kullanıcının göremediği kayıtlar da "var" olarak
 * bildirilir (visible=false, ad gizli) — aynı kişiye ikinci kart açılmasın ama yetkisiz veri sızmasın.
 */
export async function findDuplicateCandidates(
  actor: Pick<Actor, "id" | "perms">,
  input: { phone?: string | null; email?: string | null },
  excludeId?: string,
): Promise<DuplicateCandidate[]> {
  const phone = normalizePhone(input.phone);
  const email = normalizeEmail(input.email);
  if (!phone && !email) return [];
  const or: Prisma.ContactWhereInput[] = [];
  if (phone) or.push({ primaryPhone: phone }, { channels: { some: { type: { in: ["PHONE", "WHATSAPP"] }, normalized: phone } } });
  if (email) or.push({ primaryEmail: email }, { channels: { some: { type: "EMAIL", normalized: email } } });
  const rows = await prisma.contact.findMany({
    where: { deletedAt: null, OR: or, ...(excludeId ? { id: { not: excludeId } } : {}) },
    select: { id: true, number: true, fullName: true, primaryPhone: true, primaryEmail: true, city: true, district: true, channels: { select: { type: true, normalized: true } } },
    take: 10,
  });
  if (rows.length === 0) return [];
  const visibleIds = new Set(
    (await prisma.contact.findMany({ where: { id: { in: rows.map((r) => r.id) }, ...contactScope(actor) }, select: { id: true } })).map((r) => r.id),
  );
  return rows.map((r) => {
    const matchedOn: ("phone" | "email")[] = [];
    if (phone && (r.primaryPhone === phone || r.channels.some((c) => c.normalized === phone))) matchedOn.push("phone");
    if (email && (r.primaryEmail === email || r.channels.some((c) => c.normalized === email))) matchedOn.push("email");
    const visible = visibleIds.has(r.id);
    return {
      id: r.id,
      number: r.number,
      fullName: visible ? r.fullName : "Başka bir ekip üyesinin müşterisi",
      primaryPhone: visible ? r.primaryPhone : null,
      primaryEmail: visible ? r.primaryEmail : null,
      city: visible ? r.city : null,
      district: visible ? r.district : null,
      matchedOn,
      visible,
    };
  });
}

export type ContactInput = {
  firstName: string;
  lastName?: string | null;
  title?: string | null;
  organizationName?: string | null;
  phone?: string | null;
  email?: string | null;
  city?: string | null;
  district?: string | null;
  address?: string | null;
  preferredChannel: PreferredChannel;
  source: LeadSource;
  tags: string[];
  notes?: string | null;
  ownerId?: string | null;
  kvkkNotice: boolean;
  marketingConsent: boolean;
};

async function upsertOrganization(tx: Tx, name: string | null | undefined, ownerId: string | null) {
  const n = name?.trim();
  if (!n) return null;
  const existing = await tx.organization.findFirst({ where: { name: { equals: n, mode: "insensitive" }, deletedAt: null }, select: { id: true } });
  if (existing) return existing.id;
  return (await tx.organization.create({ data: { name: n, ownerId } })).id;
}

export async function syncChannels(tx: Tx, contactId: string, phone: string | null, email: string | null, rawPhone?: string | null, rawEmail?: string | null) {
  // Birincil kanalları işaretle; eski numara/e-posta silinmez (geçmiş eşleştirme için ikincil olarak kalır).
  await tx.contactChannel.updateMany({ where: { contactId }, data: { isPrimary: false } });
  if (phone) {
    await tx.contactChannel.upsert({
      where: { contactId_type_normalized: { contactId, type: "PHONE", normalized: phone } },
      create: { contactId, type: "PHONE", value: rawPhone?.trim() || phone, normalized: phone, isPrimary: true },
      update: { isPrimary: true },
    });
  }
  if (email) {
    await tx.contactChannel.upsert({
      where: { contactId_type_normalized: { contactId, type: "EMAIL", normalized: email } },
      create: { contactId, type: "EMAIL", value: rawEmail?.trim() || email, normalized: email, isPrimary: true },
      update: { isPrimary: true },
    });
  }
}

export async function recordConsents(tx: Tx, contactId: string, input: { kvkkNotice: boolean; marketingConsent: boolean }, source: string, actorId: string | null, evidence?: Prisma.InputJsonValue) {
  if (input.kvkkNotice) {
    await tx.consentEvent.create({ data: { contactId, type: "KVKK_NOTICE", action: "ACKNOWLEDGED", source, evidence, recordedById: actorId } });
  }
  if (input.marketingConsent) {
    await tx.consentEvent.create({ data: { contactId, type: "MARKETING_PHONE", action: "GRANTED", source, evidence, recordedById: actorId } });
  }
}

export async function createContact(actor: Actor, input: ContactInput, tx?: Tx) {
  assertCan(actor, "contacts.create");
  const run = async (t: Tx) => {
    const phone = normalizePhone(input.phone);
    const email = normalizeEmail(input.email);
    const ownerId = input.ownerId ?? actor.id;
    const organizationId = await upsertOrganization(t, input.organizationName, ownerId);
    const now = new Date();
    const c = await t.contact.create({
      data: {
        firstName: input.firstName.trim(),
        lastName: input.lastName?.trim() || null,
        fullName: fullNameOf(input.firstName, input.lastName),
        title: input.title?.trim() || null,
        organizationId,
        primaryPhone: phone,
        primaryEmail: email,
        city: input.city?.trim() || null,
        district: input.district?.trim() || null,
        address: input.address?.trim() || null,
        preferredChannel: input.preferredChannel,
        source: input.source,
        tags: input.tags,
        notes: input.notes?.trim() || null,
        ownerId,
        kvkkNoticeAt: input.kvkkNotice ? now : null,
        marketingConsent: input.marketingConsent,
        marketingConsentAt: input.marketingConsent ? now : null,
        createdById: actor.id,
      },
    });
    await syncChannels(t, c.id, phone, email, input.phone, input.email);
    await recordConsents(t, c.id, input, "manual", actor.id);
    await t.activity.create({ data: { type: "SYSTEM", subject: "Müşteri kaydı oluşturuldu", actorId: actor.id, contactId: c.id } });
    await audit({ actorId: actor.id, action: "contact_created", entityType: "contact", entityId: c.id, summary: c.fullName, after: redact({ ...c }) }, t);
    return c;
  };
  return tx ? run(tx) : prisma.$transaction(run);
}

export async function updateContact(actor: Actor, id: string, input: ContactInput) {
  assertCan(actor, "contacts.edit");
  return prisma.$transaction(async (t) => {
    const before = await t.contact.findFirst({ where: { id, ...contactScope(actor) } });
    if (!before) throw new Error("Müşteri bulunamadı ya da erişiminiz yok.");
    const phone = normalizePhone(input.phone);
    const email = normalizeEmail(input.email);
    const organizationId = await upsertOrganization(t, input.organizationName, before.ownerId);
    const now = new Date();
    const data = {
      firstName: input.firstName.trim(),
      lastName: input.lastName?.trim() || null,
      fullName: fullNameOf(input.firstName, input.lastName),
      title: input.title?.trim() || null,
      organizationId,
      primaryPhone: phone,
      primaryEmail: email,
      city: input.city?.trim() || null,
      district: input.district?.trim() || null,
      address: input.address?.trim() || null,
      preferredChannel: input.preferredChannel,
      source: input.source,
      tags: input.tags,
      notes: input.notes?.trim() || null,
      ownerId: input.ownerId ?? before.ownerId,
      kvkkNoticeAt: before.kvkkNoticeAt ?? (input.kvkkNotice ? now : null),
      marketingConsent: input.marketingConsent,
      marketingConsentAt: input.marketingConsent ? (before.marketingConsentAt ?? now) : null,
    };
    const after = await t.contact.update({ where: { id }, data });
    await syncChannels(t, id, phone, email, input.phone, input.email);
    if (!before.kvkkNoticeAt && input.kvkkNotice) {
      await t.consentEvent.create({ data: { contactId: id, type: "KVKK_NOTICE", action: "ACKNOWLEDGED", source: "manual", recordedById: actor.id } });
    }
    if (before.marketingConsent !== input.marketingConsent) {
      await t.consentEvent.create({ data: { contactId: id, type: "MARKETING_PHONE", action: input.marketingConsent ? "GRANTED" : "WITHDRAWN", source: "manual", recordedById: actor.id } });
    }
    const d = diff(before as unknown as Record<string, unknown>, data);
    if (d.changed.length) {
      // Telefon/e-posta değişiklikleri dahil tüm alan değişiklikleri denetime yazılır.
      await audit({ actorId: actor.id, action: "contact_updated", entityType: "contact", entityId: id, summary: `Değişen: ${d.changed.join(", ")}`, before: d.before, after: d.after }, t);
      if (d.changed.includes("ownerId")) {
        await t.activity.create({ data: { type: "ASSIGNMENT", subject: "Müşteri sorumlusu değişti", actorId: actor.id, contactId: id } });
      }
    }
    return after;
  });
}

export async function archiveContact(actor: Actor, id: string) {
  assertCan(actor, "contacts.delete");
  await prisma.$transaction(async (t) => {
    const c = await t.contact.findFirst({ where: { id, ...contactScope(actor) }, select: { id: true, fullName: true } });
    if (!c) throw new Error("Müşteri bulunamadı ya da erişiminiz yok.");
    // Yumuşak silme: ilişkiler ve geçmiş korunur.
    await t.contact.update({ where: { id }, data: { deletedAt: new Date() } });
    await audit({ actorId: actor.id, action: "contact_deleted", entityType: "contact", entityId: id, summary: c.fullName }, t);
  });
}

/**
 * Denetimli birleştirme: kaybeden kaydın tüm ilişkileri kazanana taşınır, kaybeden yumuşak silinir ve
 * mergedIntoId ile işaretlenir. Alanlarda kazananın değeri esastır; kazananda boş olanlar kaybedenden doldurulur.
 */
export async function mergeContacts(actor: Actor, winnerId: string, loserId: string) {
  assertCan(actor, "contacts.merge");
  if (winnerId === loserId) throw new Error("Aynı kayıt kendisiyle birleştirilemez.");
  return prisma.$transaction(async (t) => {
    const scope = contactScope(actor);
    const [winner, loser] = await Promise.all([
      t.contact.findFirst({ where: { id: winnerId, ...scope }, include: { channels: true } }),
      t.contact.findFirst({ where: { id: loserId, ...scope }, include: { channels: true } }),
    ]);
    if (!winner || !loser) throw new Error("Kayıtlardan biri bulunamadı ya da erişiminiz yok.");

    const fill = <K extends keyof typeof winner>(k: K) => (winner[k] ?? loser[k]) as (typeof winner)[K];
    await t.contact.update({
      where: { id: winner.id },
      data: {
        lastName: fill("lastName"),
        title: fill("title"),
        organizationId: fill("organizationId"),
        primaryPhone: fill("primaryPhone"),
        primaryEmail: fill("primaryEmail"),
        city: fill("city"),
        district: fill("district"),
        address: fill("address"),
        ownerId: fill("ownerId"),
        kvkkNoticeAt: fill("kvkkNoticeAt"),
        notes: [winner.notes, loser.notes].filter(Boolean).join("\n\n— Birleştirilen kayıttan —\n") || null,
        tags: Array.from(new Set([...winner.tags, ...loser.tags])),
        // Pazarlama izni yalnız kazananda zaten varsa korunur; kaybedenin izni kanıtıyla consent_events'te kalır.
      },
    });
    for (const ch of loser.channels) {
      const exists = winner.channels.some((w) => w.type === ch.type && w.normalized === ch.normalized);
      if (!exists) await t.contactChannel.create({ data: { contactId: winner.id, type: ch.type, value: ch.value, normalized: ch.normalized, isPrimary: false, label: ch.label } });
    }
    const move = { where: { contactId: loser.id }, data: { contactId: winner.id } };
    const counts = {
      opportunities: (await t.opportunity.updateMany(move)).count,
      projects: (await t.project.updateMany(move)).count,
      tasks: (await t.task.updateMany(move)).count,
      activities: (await t.activity.updateMany(move)).count,
      notes: (await t.note.updateMany(move)).count,
      attachments: (await t.attachment.updateMany(move)).count,
      leads: (await t.lead.updateMany(move)).count,
      appointments: (await t.appointment.updateMany(move)).count,
      quotes: (await t.quote.updateMany(move)).count,
      consentEvents: (await t.consentEvent.updateMany(move)).count,
    };
    await t.contact.update({ where: { id: loser.id }, data: { deletedAt: new Date(), mergedIntoId: winner.id } });
    await t.activity.create({
      data: { type: "SYSTEM", subject: `Müşteri kaydı birleştirildi: ${loser.fullName} (M-${String(loser.number).padStart(6, "0")})`, actorId: actor.id, contactId: winner.id, metadata: counts },
    });
    await audit(
      { actorId: actor.id, action: "merge", entityType: "contact", entityId: winner.id, summary: `${loser.fullName} → ${winner.fullName}`, before: redact({ ...loser, channels: undefined }), after: { winnerId: winner.id, loserId: loser.id, moved: counts } },
      t,
    );
    return { winnerId: winner.id, counts };
  });
}
