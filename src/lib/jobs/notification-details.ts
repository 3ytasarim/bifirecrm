import { prisma } from "@/lib/db";
import { code, fmtDateTime, fmtMoney, fmtRelative } from "@/lib/format";
import {
  APPOINTMENT_STATUS_LABELS,
  APPOINTMENT_TYPE_LABELS,
  FIREPLACE_LABELS,
  MESSAGE_CHANNEL_LABELS,
  PRIORITY_LABELS,
  PROJECT_STAGE_LABELS,
  SOURCE_LABELS,
  STAGE_LABELS,
  TASK_STATUS_LABELS,
} from "@/lib/labels";
import { fmtPhone } from "@/lib/jobs/notification-mail-template";

/**
 * Bildirim e-postası için bağlantının gösterdiği kaydın özeti (görev, fırsat, talep, yazışma, randevu, proje).
 * Kayıt bulunamazsa ya da sorgu hata verirse null döner; e-posta yine başlık + bağlantı ile gider.
 */
export type MailContact = { name: string; phone: string | null; email: string | null };
export type MailDetails = {
  /** Satır satır bilgi (etiket, değer). Boş değerler eklenmez. */
  rows: [string, string][];
  /** Müşterinin mesajı / görev açıklaması gibi serbest metin. */
  quote?: { label: string; text: string };
  /** Son mesajlar (yazışma bildirimi). */
  messages?: { inbound: boolean; text: string; at: string }[];
  contact?: MailContact;
};

type Row = [string, string | null | undefined | false];
const rows = (...r: Row[]) => r.filter((x): x is [string, string] => typeof x[1] === "string" && x[1].trim() !== "" && x[1] !== "—");
const place = (city?: string | null, district?: string | null) => [district, city].filter(Boolean).join(" / ") || null;

type ContactLike = { fullName: string; primaryPhone: string | null; primaryEmail: string | null; city?: string | null; district?: string | null } | null | undefined;
const contactOf = (c: ContactLike): MailContact | undefined => (c ? { name: c.fullName, phone: c.primaryPhone, email: c.primaryEmail } : undefined);
const contactRows = (c: MailContact | undefined): Row[] => (c ? [["Müşteri", c.name], ["Telefon", fmtPhone(c.phone)], ["E-posta", c.email]] : []);

const CONTACT_SELECT = { fullName: true, primaryPhone: true, primaryEmail: true, city: true, district: true } as const;

async function task(id: string, now: Date): Promise<MailDetails | null> {
  const t = await prisma.task.findFirst({
    where: { id, deletedAt: null },
    select: {
      title: true, description: true, status: true, priority: true, dueAt: true,
      assignee: { select: { name: true } }, createdBy: { select: { name: true } },
      contact: { select: CONTACT_SELECT },
      opportunity: { select: { number: true, title: true, contact: { select: CONTACT_SELECT } } },
      project: { select: { name: true } },
    },
  });
  if (!t) return null;
  const c = contactOf(t.contact ?? t.opportunity?.contact);
  const due = t.dueAt ? `${fmtDateTime(t.dueAt)} (${fmtRelative(t.dueAt, now.getTime())})` : null;
  return {
    rows: rows(
      ["Görev", t.title],
      ["Son tarih", due],
      ["Öncelik", PRIORITY_LABELS[t.priority]],
      ["Durum", TASK_STATUS_LABELS[t.status]],
      ["Sorumlu", t.assignee?.name ?? "Atanmamış"],
      ...contactRows(c),
      ["Fırsat", t.opportunity && `${code.opportunity(t.opportunity.number)} · ${t.opportunity.title}`],
      ["Proje", t.project?.name],
      ["Oluşturan", t.createdBy?.name],
    ),
    quote: t.description ? { label: "Görev notu", text: t.description } : undefined,
    contact: c,
  };
}

async function opportunity(id: string): Promise<MailDetails | null> {
  const o = await prisma.opportunity.findFirst({
    where: { id, deletedAt: null },
    select: {
      number: true, title: true, stage: true, source: true, fireplaceType: true, productCategory: true, productModel: true,
      city: true, district: true, message: true, estimatedAmount: true, currency: true, nextActionAt: true, nextActionNote: true,
      owner: { select: { name: true } }, contact: { select: CONTACT_SELECT },
    },
  });
  if (!o) return null;
  const c = contactOf(o.contact);
  const product = [o.fireplaceType && FIREPLACE_LABELS[o.fireplaceType], o.productCategory, o.productModel].filter(Boolean).join(" · ");
  return {
    rows: rows(
      ["Fırsat", `${code.opportunity(o.number)} · ${o.title}`],
      ...contactRows(c),
      ["Konum", place(o.city ?? o.contact.city, o.district ?? o.contact.district)],
      ["Kaynak", SOURCE_LABELS[o.source]],
      ["İlgilendiği ürün", product],
      ["Tahmini tutar", o.estimatedAmount ? fmtMoney(o.estimatedAmount, o.currency) : null],
      ["Aşama", STAGE_LABELS[o.stage]],
      ["Sorumlu", o.owner?.name ?? "Atanmamış"],
      ["Sonraki adım", o.nextActionAt && [fmtDateTime(o.nextActionAt), o.nextActionNote].filter(Boolean).join(" · ")],
    ),
    quote: o.message ? { label: "Müşterinin mesajı", text: o.message } : undefined,
    contact: c,
  };
}

async function lead(id: string): Promise<MailDetails | null> {
  const l = await prisma.lead.findUnique({
    where: { id },
    select: { name: true, phone: true, email: true, city: true, district: true, message: true, source: true, formType: true, receivedAt: true },
  });
  if (!l) return null;
  const c: MailContact = { name: l.name, phone: l.phone, email: l.email };
  return {
    rows: rows(
      ...contactRows(c),
      ["Konum", place(l.city, l.district)],
      ["Kaynak", [SOURCE_LABELS[l.source], l.formType].filter(Boolean).join(" · ")],
      ["Geliş zamanı", fmtDateTime(l.receivedAt)],
    ),
    quote: l.message ? { label: "Müşterinin mesajı", text: l.message } : undefined,
    contact: c,
  };
}

async function conversation(id: string): Promise<MailDetails | null> {
  const v = await prisma.conversation.findUnique({
    where: { id },
    select: {
      channel: true, displayName: true, phone: true, lastInboundAt: true,
      contact: { select: CONTACT_SELECT },
      messages: { orderBy: { occurredAt: "desc" }, take: 4, select: { direction: true, type: true, body: true, occurredAt: true } },
    },
  });
  if (!v) return null;
  const c = contactOf(v.contact) ?? { name: v.displayName ?? "Tanınmayan kişi", phone: v.phone, email: null };
  return {
    rows: rows(
      ["Kanal", MESSAGE_CHANNEL_LABELS[v.channel]],
      ...contactRows(c),
      ["Kayıt", v.contact ? "CRM'de kayıtlı müşteri" : "Henüz müşteri kaydı yok"],
      ["Son mesaj", v.lastInboundAt && fmtDateTime(v.lastInboundAt)],
    ),
    messages: v.messages
      .reverse()
      .map((m) => ({ inbound: m.direction === "INBOUND", text: m.body?.trim() || `[${m.type}]`, at: fmtDateTime(m.occurredAt) })),
    contact: c,
  };
}

async function appointment(id: string): Promise<MailDetails | null> {
  const a = await prisma.appointment.findUnique({
    where: { id },
    select: {
      type: true, status: true, startAt: true, endAt: true, location: true, requestedNote: true, notes: true,
      contact: { select: CONTACT_SELECT }, opportunity: { select: { number: true, title: true } },
    },
  });
  if (!a) return null;
  const c = contactOf(a.contact);
  const when = a.startAt ? fmtDateTime(a.startAt) + (a.endAt ? ` – ${fmtDateTime(a.endAt).slice(-5)}` : "") : a.requestedNote && `Müşteri tercihi: ${a.requestedNote}`;
  return {
    rows: rows(
      ["Randevu", APPOINTMENT_TYPE_LABELS[a.type]],
      ["Zaman", when],
      ["Adres", a.location ?? place(a.contact.city, a.contact.district)],
      ["Durum", APPOINTMENT_STATUS_LABELS[a.status]],
      ...contactRows(c),
      ["Fırsat", a.opportunity && `${code.opportunity(a.opportunity.number)} · ${a.opportunity.title}`],
    ),
    quote: a.notes ? { label: "Not", text: a.notes } : undefined,
    contact: c,
  };
}

async function project(id: string): Promise<MailDetails | null> {
  const p = await prisma.project.findFirst({ where: { id, deletedAt: null }, select: { name: true, stage: true, contact: { select: CONTACT_SELECT } } });
  if (!p) return null;
  const c = contactOf(p.contact);
  return { rows: rows(["Proje", p.name], ["Aşama", PROJECT_STAGE_LABELS[p.stage]], ...contactRows(c)), contact: c };
}

const UUID = "[0-9a-f-]{36}";
const ROUTES: [RegExp, (id: string, now: Date) => Promise<MailDetails | null>][] = [
  [new RegExp(`^/gorevler\\?id=(${UUID})$`, "i"), task],
  [new RegExp(`^/firsatlar/(${UUID})$`, "i"), opportunity],
  [new RegExp(`^/talepler/yeni\\?talep=(${UUID})$`, "i"), lead],
  [new RegExp(`^/mesajlar/(${UUID})$`, "i"), conversation],
  [new RegExp(`^/takvim/(${UUID})$`, "i"), appointment],
  [new RegExp(`^/projeler/(${UUID})$`, "i"), project],
];

export async function loadMailDetails(link: string | null, now = new Date()): Promise<MailDetails | null> {
  if (!link) return null;
  for (const [re, load] of ROUTES) {
    const m = re.exec(link);
    if (!m) continue;
    try {
      return await load(m[1], now);
    } catch {
      return null; // Detay yüklenemezse e-posta yine sade haliyle gider.
    }
  }
  return null;
}
