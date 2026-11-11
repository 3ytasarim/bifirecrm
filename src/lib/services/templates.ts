import "server-only";
import type { TemplateChannel } from "@prisma/client";
import { prisma } from "@/lib/db";
import { audit } from "@/lib/audit";
import { assertCan, ForbiddenError, type Actor } from "@/lib/rbac/assert";
import { appointmentScope, contactScope, opportunityScope, quoteScope } from "@/lib/rbac/scope";
import { code, fmtDate, fmtDateTime } from "@/lib/format";
import { formatPhone } from "@/lib/normalize";
import { formatAmount } from "@/lib/quotes/calc";
import { extractVariables, unknownVariables, type TemplateContext } from "@/lib/templates/render";
import { quoteProfile } from "@/lib/services/quotes";
import { RuleError } from "@/lib/errors";

/**
 * Mesaj şablonları: ekip içinde ortak metinler. CRM müşteriye OTOMATİK MESAJ GÖNDERMEZ (e-posta/WhatsApp/SMS kanalı
 * bağlı değil); şablon bir müşteri için doldurulur, kullanıcı metni kopyalayıp kendi kanalından iletir.
 */
export type TemplateInput = { name: string; channel: TemplateChannel; subject: string | null; body: string };

function validate(i: TemplateInput) {
  const unknown = unknownVariables(i.body + " " + (i.subject ?? ""));
  if (unknown.length) throw new RuleError(`Tanımsız değişken: ${unknown.map((v) => `{{${v}}}`).join(", ")}. Listeden seçin.`);
  if (i.channel === "SMS" && i.body.length > 900) throw new RuleError("SMS şablonu en fazla 900 karakter olabilir.");
}

export async function saveTemplate(actor: Actor, id: string | null, i: TemplateInput) {
  assertCan(actor, "templates.manage");
  validate(i);
  const variables = extractVariables(i.body + " " + (i.subject ?? ""));
  const data = { name: i.name, channel: i.channel, subject: i.channel === "EMAIL" ? i.subject : null, body: i.body, variables };
  return prisma.$transaction(async (t) => {
    if (id) {
      const before = await t.messageTemplate.findUnique({ where: { id } });
      if (!before) throw new ForbiddenError("Şablon bulunamadı.");
      const after = await t.messageTemplate.update({ where: { id }, data });
      await audit({ actorId: actor.id, action: "template_saved", entityType: "template", entityId: id, summary: i.name, before: { name: before.name, body: before.body }, after: { name: i.name, body: i.body } }, t);
      return after;
    }
    const created = await t.messageTemplate.create({ data: { ...data, createdById: actor.id } });
    await audit({ actorId: actor.id, action: "template_saved", entityType: "template", entityId: created.id, summary: `${i.name} (yeni)` }, t);
    return created;
  });
}

export async function setTemplateActive(actor: Actor, id: string, active: boolean) {
  assertCan(actor, "templates.manage");
  const t = await prisma.messageTemplate.update({ where: { id }, data: { active } });
  await audit({ actorId: actor.id, action: "template_saved", entityType: "template", entityId: id, summary: `${t.name} ${active ? "etkinleştirildi" : "arşivlendi"}` });
  return t;
}

/** Bir müşteri için değişken değerleri (yalnız kullanıcının erişebildiği kayıtlardan). */
export async function templateContext(actor: Actor, contactId: string): Promise<{ contactName: string; ctx: TemplateContext }> {
  const c = await prisma.contact.findFirst({ where: { id: contactId, ...contactScope(actor) }, select: { id: true, firstName: true, lastName: true, fullName: true, owner: { select: { name: true, phone: true } } } });
  if (!c) throw new ForbiddenError("Müşteri bulunamadı ya da erişiminiz yok.");
  const [opp, quote, appt, profile] = await Promise.all([
    prisma.opportunity.findFirst({ where: { contactId, ...opportunityScope(actor), stage: { notIn: ["LOST"] } }, orderBy: { updatedAt: "desc" }, select: { title: true, productModel: true, productCategory: true, owner: { select: { name: true, phone: true } } } }),
    actor.perms.has("quotes.view") ? prisma.quote.findFirst({ where: { contactId, ...quoteScope(actor), status: { in: ["APPROVED", "SENT", "ACCEPTED"] } }, orderBy: { createdAt: "desc" }, select: { number: true, grandTotal: true, currency: true, validUntil: true } }) : null,
    actor.perms.has("calendar.view") || actor.perms.has("calendar.view_all")
      ? prisma.appointment.findFirst({ where: { contactId, ...appointmentScope(actor), startAt: { gte: new Date() }, status: { in: ["PROPOSED", "CONFIRMED"] } }, orderBy: { startAt: "asc" }, select: { startAt: true, location: true } })
      : null,
    quoteProfile(),
  ]);
  const rep = opp?.owner ?? c.owner;
  return {
    contactName: c.fullName,
    ctx: {
      ad: c.firstName,
      soyad: c.lastName,
      adsoyad: c.fullName,
      firsat: opp?.title,
      urun: opp?.productModel ?? opp?.productCategory,
      teklif_no: quote ? code.quote(quote.number) : null,
      teklif_tutar: quote ? formatAmount(quote.grandTotal.toString(), quote.currency) : null,
      teklif_gecerlilik: quote?.validUntil ? fmtDate(quote.validUntil) : null,
      randevu_tarih: appt?.startAt ? fmtDateTime(appt.startAt) : null,
      randevu_yer: appt?.location,
      temsilci: rep?.name,
      temsilci_tel: rep?.phone ? formatPhone(rep.phone) : null,
      firma: profile.header.split(/\r?\n/)[0]?.trim() || null,
    },
  };
}
