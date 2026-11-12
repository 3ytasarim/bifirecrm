import "server-only";
import type { FireplaceType, LeadSource, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { audit } from "@/lib/audit";
import { notify } from "@/lib/notifications";
import { normalizeEmail, normalizePhone, splitName } from "@/lib/normalize";
import { assertCan, type Actor } from "@/lib/rbac/assert";
import { createContact, findDuplicateCandidates, recordConsents } from "./contacts";
import { createOpportunity } from "./opportunities";
import { SOURCE_LABELS } from "@/lib/labels";
import { linkConversationsForLead } from "./channels";

export type IntakeInput = {
  name: string;
  phone?: string | null;
  email?: string | null;
  city?: string | null;
  district?: string | null;
  source: LeadSource;
  fireplaceType?: FireplaceType | null;
  productCategory?: string | null;
  productModel?: string | null;
  message?: string | null;
  ownerId?: string | null;
  kvkkNotice: boolean;
  marketingConsent: boolean;
  /** "new" = bilerek yeni müşteri; uuid = seçilen mevcut müşteri; undefined = adaya göre karar ver. */
  contactChoice?: "new" | string;
  /** Bekleyen talep (status RECEIVED, ör. eşleşme kontrolü bekleyen web formu) işleniyorsa: yeni lead açılmaz, bu kayıt dönüştürülür. */
  leadId?: string | null;
};

export type IntakeResult =
  | { kind: "needs_choice"; candidates: Awaited<ReturnType<typeof findDuplicateCandidates>> }
  | { kind: "created"; leadId: string; contactId: string; opportunityId: string; taskId: string; reusedContact: boolean };

/**
 * Hızlı kayıt (telefon / showroom / referans / DM). Eşleşen müşteri varsa kullanıcıdan seçim ister —
 * aynı kişiye ikinci kart açılmaz, çakışan kayıtlar sessizce birleştirilmez. Seçimden sonra:
 * lead (CONVERTED) + müşteri (mevcut ya da yeni) + yeni fırsat + 24 saatlik ilk takip görevi + sorumluya iç bildirim.
 */
export async function quickIntake(actor: Actor, input: IntakeInput): Promise<IntakeResult> {
  assertCan(actor, "contacts.create");
  assertCan(actor, "opportunities.create");
  const phone = normalizePhone(input.phone);
  const email = normalizeEmail(input.email);

  if (!input.contactChoice) {
    const candidates = await findDuplicateCandidates(actor, { phone, email });
    if (candidates.length) return { kind: "needs_choice", candidates };
  }

  const ownerId = input.ownerId ?? actor.id;
  if (ownerId !== actor.id) assertCan(actor, "opportunities.assign");
  if (input.leadId) assertCan(actor, "leads.process");

  return prisma.$transaction(async (t) => {
    if (input.leadId) {
      // Aynı talep iki kez işlenmesin: satırı kilitle ve hâlâ bekliyor mu bak.
      const pending = await t.$queryRaw<{ id: string }[]>`SELECT id::text FROM leads WHERE id = ${input.leadId}::uuid AND status = 'RECEIVED' FOR UPDATE`;
      if (!pending.length) throw new Error("Bu talep zaten işlenmiş ya da bulunamadı.");
    }
    let contactId: string;
    let contactName = input.name.trim();
    let reused = false;
    if (input.contactChoice && input.contactChoice !== "new") {
      // Seçilen mevcut müşteri gerçekten bu telefon/e-posta ile eşleşiyor mu? (Rastgele id ile başka kayda bağlanmayı engeller.)
      const candidates = await findDuplicateCandidates(actor, { phone, email });
      const match = candidates.find((c) => c.id === input.contactChoice);
      if (!match) throw new Error("Seçilen müşteri bu telefon/e-posta ile eşleşmiyor.");
      contactId = input.contactChoice;
      if (match.visible) contactName = match.fullName;
      reused = true;
      await recordConsents(t, contactId, input, `manual:${input.source}`, actor.id);
    } else {
      const { firstName, lastName } = splitName(input.name);
      const c = await createContact(
        actor,
        { firstName, lastName, phone: input.phone, email: input.email, city: input.city, district: input.district, preferredChannel: "ANY", source: input.source, tags: [], ownerId, kvkkNotice: input.kvkkNotice, marketingConsent: input.marketingConsent },
        t,
      );
      contactId = c.id;
    }

    const title = [input.productModel || input.productCategory || "Şömine talebi", input.district].filter(Boolean).join(" · ");
    const opp = await createOpportunity(
      actor,
      { title, contactId, source: input.source, ownerId, fireplaceType: input.fireplaceType, productCategory: input.productCategory, productModel: input.productModel, city: input.city, district: input.district, message: input.message, currency: "TRY", nextActionAt: new Date(Date.now() + 24 * 3600_000), nextActionNote: "İlk dönüş" },
      t,
      { skipContactScope: reused ? false : true },
    );

    const lead = input.leadId
      ? await t.lead.update({ where: { id: input.leadId }, data: { status: "CONVERTED", contactId, opportunityId: opp.id, processedAt: new Date() } })
      : await t.lead.create({
          data: {
            source: input.source,
            status: "CONVERTED",
            formType: "manual",
            name: input.name.trim(),
            phone,
            email,
            city: input.city || null,
            district: input.district || null,
            message: input.message || null,
            contactId,
            opportunityId: opp.id,
            processedAt: new Date(),
            createdById: actor.id,
          },
        });
    // Talebin ekleri (ör. web formu fotoğrafı) müşteri ve fırsata bağlanır.
    if (input.leadId) await t.attachment.updateMany({ where: { leadId: lead.id }, data: { contactId, opportunityId: opp.id } });
    // WhatsApp/Instagram mesajından açılmış talepse yazışma da bu müşteriye bağlanır.
    if (input.leadId) await linkConversationsForLead(t, lead.id);

    const task = await t.task.create({
      data: {
        title: `İlk dönüş: ${contactName}`,
        description: `${SOURCE_LABELS[input.source]} üzerinden gelen talep. Müşteriye dönüş yapın ve ihtiyacı netleştirin.`,
        priority: "HIGH",
        dueAt: new Date(Date.now() + 24 * 3600_000),
        assigneeId: ownerId,
        createdById: actor.id,
        contactId,
        opportunityId: opp.id,
      },
    });
    await t.activity.create({
      data: { type: "SYSTEM", subject: `Hızlı kayıt: ${SOURCE_LABELS[input.source]}`, body: input.message || null, actorId: actor.id, contactId, opportunityId: opp.id, metadata: { leadId: lead.id } as Prisma.InputJsonValue },
    });
    await audit({ actorId: actor.id, action: "lead_converted", entityType: "lead", entityId: lead.id, summary: `${input.name} → ${title}`, after: { contactId, opportunityId: opp.id, reusedContact: reused } }, t);
    if (ownerId !== actor.id) {
      await notify({ userId: ownerId, type: "lead", title: `Yeni talep size atandı: ${input.name}`, link: `/firsatlar/${opp.id}` }, t);
    }
    return { kind: "created", leadId: lead.id, contactId, opportunityId: opp.id, taskId: task.id, reusedContact: reused };
  });
}
