import "server-only";
import type { MessageChannel, MessageStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { audit } from "@/lib/audit";
import { notify } from "@/lib/notifications";
import { RuleError } from "@/lib/errors";
import { rateLimit } from "@/lib/rate-limit";
import { formatPhone, normalizePhone } from "@/lib/normalize";
import { assertCan, type Actor } from "@/lib/rbac/assert";
import type { Permission } from "@/lib/rbac/permissions";
import { enqueue } from "@/lib/jobs/queue";
import { GraphError, graphRequest } from "@/lib/integrations/graph";
import { handleProviderError, markConnectionOk, TokenError } from "@/lib/integrations/health";
import { whatsappConfig } from "@/lib/integrations/channels-config";
import { type GraphTemplate, type LeadField, mapLeadFields, renderTemplateBody, templateShape, validateTemplateParams } from "@/lib/integrations/channel-rules";
import type { InstagramMessagePayload, LeadgenPayload, WhatsappMessagePayload, WhatsappStatusPayload } from "@/lib/integrations/meta-webhook";
import { findDuplicateCandidates } from "./contacts";
import { inboundOwnerId, ingestInboundLead, managerIds } from "./lead-ingest";

const SYSTEM_SCOPE = { id: "00000000-0000-0000-0000-000000000000", perms: new Set<Permission>(["contacts.view_all"]) };
const CHANNEL_LABEL: Record<MessageChannel, string> = { WHATSAPP: "WhatsApp", INSTAGRAM: "Instagram" };

async function loadEvent(eventId: string) {
  const ev = await prisma.integrationEvent.findUnique({ where: { id: eventId } });
  if (!ev) throw new Error(`Olay bulunamadı: ${eventId}`);
  return ev;
}
const eventDone = (id: string, leadId?: string | null) => prisma.integrationEvent.update({ where: { id }, data: { status: "SUCCESS", processedAt: new Date(), ...(leadId ? { leadId } : {}) } });

/** Worker hata verdiğinde olayı da işaretler (Entegrasyonlar ekranında görünür). */
export async function markEventFailed(eventId: string, error: string, dead: boolean) {
  await prisma.integrationEvent.update({ where: { id: eventId }, data: { status: dead ? "DEAD_LETTER" : "RETRY", attempts: { increment: 1 }, lastError: error.slice(0, 2000) } }).catch(() => {});
}

// ───────────────────────────── Meta Lead Ads ─────────────────────────────

type GraphLead = { id: string; created_time?: string; field_data?: LeadField[]; form_id?: string; ad_id?: string; ad_name?: string; campaign_name?: string; platform?: string; is_organic?: boolean };

export async function processLeadgen(eventId: string) {
  const ev = await loadEvent(eventId);
  const p = ev.payload as unknown as LeadgenPayload;
  const token = env().META_ACCESS_TOKEN;
  let lead: GraphLead;
  try {
    if (!token) throw new TokenError("META_ACCESS_TOKEN tanımlı değil; reklam formu verisi çekilemiyor.", "META_LEAD_ADS");
    lead = await graphRequest<GraphLead>(p.leadgenId, { token, query: { fields: "created_time,field_data,form_id,ad_id,ad_name,campaign_name,platform,is_organic" } });
  } catch (e) {
    return handleProviderError("META_LEAD_ADS", e);
  }
  await markConnectionOk("META_LEAD_ADS");
  const f = mapLeadFields(lead.field_data ?? []);
  const source = lead.platform === "ig" ? "INSTAGRAM_LEAD_AD" : "FACEBOOK_LEAD_AD";
  const details = [...f.extra, lead.campaign_name ? `Kampanya: ${lead.campaign_name}` : null, lead.ad_name ? `Reklam: ${lead.ad_name}` : null, `Form: ${lead.form_id ?? p.formId ?? "?"}`].filter(Boolean).join("\n");
  const r = await ingestInboundLead({
    source,
    submissionId: p.leadgenId,
    formType: "meta_lead_form",
    name: f.name ?? "Reklam formu başvurusu",
    phone: f.phone,
    email: f.email,
    city: f.city,
    district: f.district,
    details,
    titleHint: lead.campaign_name ? `Reklam: ${lead.campaign_name}`.slice(0, 120) : "Reklam formu talebi",
    payload: { leadgenId: p.leadgenId, formId: lead.form_id ?? p.formId, adId: lead.ad_id ?? p.adId, platform: lead.platform ?? null, isOrganic: lead.is_organic ?? null, fields: lead.field_data ?? [] } as Prisma.InputJsonValue,
    receivedAt: lead.created_time ? new Date(lead.created_time) : new Date(),
    // Meta formundaki gizlilik metni CRM'in KVKK aydınlatması sayılmaz; kanıt yoksa kayıt yapılmaz.
    consent: { kvkkNotice: false, noticeAt: null, source: `meta:form:${lead.form_id ?? p.formId ?? "?"}`, evidence: null },
  });
  await eventDone(ev.id, r.leadId);
  return r;
}

// ───────────────────────────── Gelen mesajlar (WhatsApp + Instagram) ─────────────────────────────

type Inbound = {
  channel: MessageChannel;
  threadId: string;
  displayName: string | null;
  phone: string | null;
  externalMessageId: string;
  kind: string;
  text: string | null;
  occurredAt: Date;
  outbound: boolean;
};

/** Yazışmayı müşteriye bağlar: tek eşleşme varsa doğrudan, bekleyen talep dönüştürülmüşse onun müşterisine. */
async function resolveContact(t: Prisma.TransactionClient, conv: { id: string; channel: MessageChannel; externalThreadId: string; phone: string | null; contactId: string | null; leadId: string | null }) {
  if (conv.contactId) return conv.contactId;
  let contactId: string | null = null;
  if (conv.leadId) {
    const lead = await t.lead.findUnique({ where: { id: conv.leadId }, select: { contactId: true } });
    contactId = lead?.contactId ?? null;
  }
  if (!contactId) {
    const type = conv.channel === "WHATSAPP" ? "WHATSAPP" : "INSTAGRAM";
    const byChannel = await t.contactChannel.findMany({ where: { type, normalized: conv.channel === "WHATSAPP" ? (conv.phone ?? "-") : conv.externalThreadId, contact: { deletedAt: null } }, select: { contactId: true }, take: 2 });
    if (byChannel.length === 1) contactId = byChannel[0].contactId;
  }
  if (!contactId && conv.channel === "WHATSAPP" && conv.phone) {
    const c = await findDuplicateCandidates(SYSTEM_SCOPE, { phone: conv.phone, email: null });
    if (c.length === 1) contactId = c[0].id;
  }
  if (!contactId) return null;
  await t.conversation.update({ where: { id: conv.id }, data: { contactId } });
  const type = conv.channel === "WHATSAPP" ? "WHATSAPP" : "INSTAGRAM";
  const normalized = conv.channel === "WHATSAPP" ? conv.phone : conv.externalThreadId;
  if (normalized) {
    await t.contactChannel.upsert({ where: { contactId_type_normalized: { contactId, type, normalized } }, create: { contactId, type, value: conv.channel === "WHATSAPP" ? formatPhone(normalized) : normalized, normalized, isPrimary: false, label: conv.channel === "INSTAGRAM" ? "Instagram (mesaj kimliği)" : null }, update: {} });
  }
  return contactId;
}

async function recordInbound(m: Inbound) {
  return prisma.$transaction(async (t) => {
    const conv = await t.conversation.upsert({
      where: { channel_externalThreadId: { channel: m.channel, externalThreadId: m.threadId } },
      create: { channel: m.channel, externalThreadId: m.threadId, displayName: m.displayName, phone: m.phone },
      update: {},
    });
    const exists = await t.message.findUnique({ where: { conversationId_externalMessageId: { conversationId: conv.id, externalMessageId: m.externalMessageId } }, select: { id: true } });
    if (exists) return { conversationId: conv.id, duplicate: true };
    await t.message.create({
      data: { conversationId: conv.id, direction: m.outbound ? "OUTBOUND" : "INBOUND", externalMessageId: m.externalMessageId, type: m.kind, body: m.text, status: m.outbound ? "SENT" : "RECEIVED", occurredAt: m.occurredAt },
    });
    const newer = !conv.lastMessageAt || conv.lastMessageAt < m.occurredAt;
    await t.conversation.update({
      where: { id: conv.id },
      data: {
        ...(newer ? { lastMessageAt: m.occurredAt } : {}),
        ...(!m.outbound && (!conv.lastInboundAt || conv.lastInboundAt < m.occurredAt) ? { lastInboundAt: m.occurredAt } : {}),
        ...(!m.outbound ? { unreadCount: { increment: 1 } } : {}),
        ...(!conv.displayName && m.displayName ? { displayName: m.displayName } : {}),
      },
    });
    if (m.outbound) return { conversationId: conv.id, duplicate: false };

    let contactId = await resolveContact(t, conv);
    // Tanınmayan kişi: bir kez "Yeni" talep açılır; ekip Talepler ekranından müşteriye dönüştürür (sessiz kart açılmaz).
    if (!contactId && !conv.leadId) {
      const label = CHANNEL_LABEL[m.channel];
      const lead = await t.lead.create({
        data: {
          source: m.channel === "WHATSAPP" ? "WHATSAPP" : "INSTAGRAM_DM",
          status: "RECEIVED",
          sourceSubmissionId: `conv:${conv.id}`,
          formType: "message",
          name: (m.displayName ?? (m.phone ? `${label} ${formatPhone(m.phone)}` : `${label} kullanıcısı`)).slice(0, 200),
          phone: m.phone,
          message: m.text,
          payload: { conversationId: conv.id } as Prisma.InputJsonValue,
          receivedAt: m.occurredAt,
        },
      });
      await t.conversation.update({ where: { id: conv.id }, data: { leadId: lead.id } });
      await audit({ actorId: null, action: "lead_received", entityType: "lead", entityId: lead.id, summary: `${label} mesajı (eşleşen müşteri yok)` }, t);
      contactId = null;
    }

    const contact = contactId ? await t.contact.findUnique({ where: { id: contactId }, select: { ownerId: true, fullName: true } }) : null;
    const owner = conv.assignedUserId ?? contact?.ownerId ?? (await inboundOwnerId());
    const recipients = owner ? [owner] : await managerIds();
    const hour = m.occurredAt.toISOString().slice(0, 13);
    for (const uid of recipients) {
      await notify({ userId: uid, type: "message", title: `Yeni ${CHANNEL_LABEL[m.channel]} mesajı: ${contact?.fullName ?? conv.displayName ?? m.displayName ?? "tanınmayan kişi"}`, body: m.text?.slice(0, 140) ?? undefined, link: `/mesajlar/${conv.id}`, dedupeKey: `msg:${conv.id}:${hour}` }, t);
    }
    return { conversationId: conv.id, duplicate: false };
  });
}

export async function processWhatsappMessage(eventId: string) {
  const ev = await loadEvent(eventId);
  const p = ev.payload as unknown as WhatsappMessagePayload;
  const r = await recordInbound({ channel: "WHATSAPP", threadId: p.waId, displayName: p.name, phone: normalizePhone(`+${p.waId}`), externalMessageId: p.id, kind: p.kind, text: p.text, occurredAt: new Date(p.timestamp), outbound: false });
  await eventDone(ev.id);
  return r;
}

export async function processInstagramMessage(eventId: string) {
  const ev = await loadEvent(eventId);
  const p = ev.payload as unknown as InstagramMessagePayload;
  const own = env().INSTAGRAM_ACCOUNT_ID;
  if (own && p.accountId !== own) {
    await eventDone(ev.id); // başka bir hesaba ait olay
    return { conversationId: null, duplicate: false, ignored: true };
  }
  // Yeni yazışmada görünen ad (kullanıcı adı) bir kez denenir; alınamazsa kimlikle devam edilir.
  let displayName: string | null = null;
  const known = await prisma.conversation.findUnique({ where: { channel_externalThreadId: { channel: "INSTAGRAM", externalThreadId: p.igUserId } }, select: { displayName: true } });
  const token = env().META_ACCESS_TOKEN;
  if (!known?.displayName && token && !p.fromBusiness) {
    try {
      const u = await graphRequest<{ name?: string; username?: string }>(p.igUserId, { token, query: { fields: "name,username" }, timeoutMs: 8000 });
      displayName = u.username ? `@${u.username}${u.name ? ` (${u.name})` : ""}` : (u.name ?? null);
    } catch (e) {
      if (e instanceof GraphError && e.auth) await handleProviderError("INSTAGRAM_DM", e).catch(() => {});
    }
  }
  const r = await recordInbound({ channel: "INSTAGRAM", threadId: p.igUserId, displayName, phone: null, externalMessageId: p.mid, kind: p.kind, text: p.text, occurredAt: new Date(p.timestamp), outbound: p.fromBusiness });
  await eventDone(ev.id);
  return r;
}

const STATUS_RANK: Record<MessageStatus, number> = { QUEUED: 0, SENDING: 1, SENT: 2, DELIVERED: 3, READ: 4, RECEIVED: 0, FAILED: 5 };
const WA_STATUS: Record<string, MessageStatus> = { sent: "SENT", delivered: "DELIVERED", read: "READ", failed: "FAILED" };

/** Giden mesaj durum bildirimi (gönderildi → iletildi → okundu / başarısız). Sıra dışı gelen bildirim durumu geri almaz. */
export async function processWhatsappStatus(eventId: string, attempt: number) {
  const ev = await loadEvent(eventId);
  const p = ev.payload as unknown as WhatsappStatusPayload;
  const next = WA_STATUS[p.status];
  const msg = await prisma.message.findFirst({ where: { externalMessageId: p.id, direction: "OUTBOUND" }, select: { id: true, status: true } });
  if (!msg) {
    // Gönderim işi kimliği henüz yazmamış olabilir → birkaç kez yeniden dene; sonra CRM dışı gönderim kabul et.
    if (attempt < 3) throw new Error(`Durum bildirimi için mesaj henüz yok: ${p.id}`);
    await prisma.integrationEvent.update({ where: { id: ev.id }, data: { status: "SUCCESS", processedAt: new Date(), lastError: "CRM'de karşılığı olmayan mesaj (WhatsApp Yöneticisi'nden gönderilmiş olabilir)" } });
    return { updated: false };
  }
  if (next && (STATUS_RANK[next] > STATUS_RANK[msg.status] || next === "FAILED")) {
    await prisma.message.update({ where: { id: msg.id }, data: { status: next, ...(next === "FAILED" ? { error: p.error ?? "WhatsApp iletimi başarısız" } : {}) } });
  }
  await eventDone(ev.id);
  return { updated: true };
}

// ───────────────────────────── WhatsApp şablonları ─────────────────────────────

export async function syncWhatsappTemplates() {
  const cfg = whatsappConfig();
  if (!cfg) throw new TokenError("WhatsApp yapılandırılmadı (WHATSAPP_* anahtarları eksik).", "WHATSAPP");
  const all: GraphTemplate[] = [];
  try {
    let after: string | undefined;
    for (let page = 0; page < 20; page++) {
      const r = await graphRequest<{ data: GraphTemplate[]; paging?: { cursors?: { after?: string }; next?: string } }>(`${cfg.wabaId}/message_templates`, {
        token: cfg.token,
        query: { fields: "id,name,language,status,category,components", limit: "100", ...(after ? { after } : {}) },
      });
      all.push(...(r.data ?? []));
      after = r.paging?.next ? r.paging.cursors?.after : undefined;
      if (!after) break;
    }
  } catch (e) {
    return handleProviderError("WHATSAPP", e);
  }
  const now = new Date();
  for (const t of all) {
    const s = templateShape(t);
    await prisma.whatsappTemplate.upsert({
      where: { name_language: { name: t.name, language: t.language } },
      create: { name: t.name, language: t.language, category: t.category, status: t.status, body: s.body, paramCount: s.paramCount, externalId: t.id, syncedAt: now },
      update: { category: t.category, status: t.status, body: s.body, paramCount: s.paramCount, externalId: t.id, syncedAt: now },
    });
  }
  // Meta'da artık olmayan şablon gönderilemez.
  await prisma.whatsappTemplate.updateMany({ where: { syncedAt: { lt: now } }, data: { status: "DELETED" } });
  await markConnectionOk("WHATSAPP");
  return { count: all.length };
}

export async function requestTemplateSync(actor: Actor) {
  assertCan(actor, "integrations.manage");
  if (!whatsappConfig()) throw new RuleError("WhatsApp bağlantısı yapılandırılmadı (.env'de WHATSAPP_* anahtarları yok).");
  await enqueue("whatsapp.sync_templates", {}, { maxAttempts: 3 });
  await audit({ actorId: actor.id, action: "whatsapp_template_sync", entityType: "integration", entityId: "WHATSAPP" });
}

// ───────────────────────────── WhatsApp gönderimi (yalnız onaylı şablon) ─────────────────────────────

async function latestConsent(contactId: string, type: "MARKETING_WHATSAPP") {
  const e = await prisma.consentEvent.findFirst({ where: { contactId, type }, orderBy: { occurredAt: "desc" }, select: { action: true } });
  return e?.action ?? null;
}

/**
 * Onaylı WhatsApp şablonunu kuyruğa alır. Kurallar:
 *  - yalnız Meta'da APPROVED ve CRM'in desteklediği (paramCount ≥ 0) şablon,
 *  - PAZARLAMA şablonu → müşterinin kayıtlı WhatsApp pazarlama izni (son kayıt GRANTED) şart,
 *  - HİZMET/DOĞRULAMA şablonu → kişi bize WhatsApp'tan yazmış olmalı ya da aydınlatmalı formla numarasını vermiş olmalı,
 *  - bağlantı "Hata" durumundaysa gönderim alınmaz.
 */
export async function sendWhatsappTemplate(actor: Actor, input: { conversationId?: string | null; contactId?: string | null; templateId: string; params: string[] }) {
  assertCan(actor, "messages.send");
  const cfg = whatsappConfig();
  if (!cfg) throw new RuleError("WhatsApp bağlantısı yapılandırılmadı.");
  const conn = await prisma.integrationConnection.findUnique({ where: { provider: "WHATSAPP" }, select: { status: true } });
  if (conn?.status === "ERROR") throw new RuleError("WhatsApp bağlantısı hata durumunda; Entegrasyonlar ekranını kontrol edin.");
  if (conn?.status === "DISABLED") throw new RuleError("WhatsApp bağlantısı kapalı.");

  const tpl = await prisma.whatsappTemplate.findUnique({ where: { id: input.templateId } });
  if (!tpl || tpl.status !== "APPROVED") throw new RuleError("Yalnız Meta tarafından onaylanmış şablon gönderilebilir.");
  if (tpl.paramCount < 0) throw new RuleError("Bu şablonun başlık/buton yapısı CRM'den gönderimi desteklemiyor.");
  const params = input.params.map((p) => p.trim());
  const invalid = validateTemplateParams(params, tpl.paramCount);
  if (invalid) throw new RuleError(invalid);

  // Hedef: verilen yazışma ya da müşterinin WhatsApp/telefon numarası. Yazışma kaydı yalnız tüm kurallar geçince açılır.
  let conv = input.conversationId ? await prisma.conversation.findUnique({ where: { id: input.conversationId } }) : null;
  if (input.conversationId && (!conv || conv.channel !== "WHATSAPP")) throw new RuleError("WhatsApp yazışması bulunamadı.");
  let contactId = conv?.contactId ?? input.contactId ?? null;
  let target: { waId: string; phone: string } | null = null;
  if (!conv) {
    if (!contactId) throw new RuleError("Alıcı seçilmedi.");
    const c = await prisma.contact.findFirst({ where: { id: contactId, deletedAt: null }, select: { primaryPhone: true, channels: { where: { type: "WHATSAPP" }, select: { normalized: true }, take: 1 } } });
    const phone = c?.channels[0]?.normalized ?? c?.primaryPhone ?? null;
    if (!phone) throw new RuleError("Müşterinin WhatsApp/telefon numarası yok.");
    target = { waId: phone.replace(/^\+/, ""), phone };
    conv = await prisma.conversation.findUnique({ where: { channel_externalThreadId: { channel: "WHATSAPP", externalThreadId: target.waId } } });
    if (conv?.contactId && conv.contactId !== contactId) throw new RuleError("Bu numara başka bir müşterinin yazışmasına bağlı.");
  }
  contactId = conv?.contactId ?? contactId;

  if (tpl.category === "MARKETING") {
    if (!contactId || (await latestConsent(contactId, "MARKETING_WHATSAPP")) !== "GRANTED") throw new RuleError("Pazarlama şablonu için müşterinin kayıtlı WhatsApp pazarlama izni gerekli.");
  } else {
    const c = contactId ? await prisma.contact.findUnique({ where: { id: contactId }, select: { kvkkNoticeAt: true } }) : null;
    if (!conv?.lastInboundAt && !c?.kvkkNoticeAt) throw new RuleError("Kişi size WhatsApp'tan yazmamış ve numarasını aydınlatmalı bir formla vermemiş; şablon gönderilemez.");
  }

  const rl = await rateLimit(`wa-send:${actor.id}`, 30, 600);
  if (!rl.ok) throw new RuleError("Çok fazla gönderim; birkaç dakika sonra tekrar deneyin.");

  const body = renderTemplateBody(tpl.body, params);
  const existing = conv;
  return prisma.$transaction(async (t) => {
    const cv =
      existing ??
      (await t.conversation.upsert({
        where: { channel_externalThreadId: { channel: "WHATSAPP", externalThreadId: target!.waId } },
        create: { channel: "WHATSAPP", externalThreadId: target!.waId, phone: target!.phone, contactId },
        update: {},
      }));
    const m = await t.message.create({ data: { conversationId: cv.id, direction: "OUTBOUND", type: "template", body, templateId: tpl.id, templateParams: params, status: "QUEUED", sentById: actor.id } });
    await t.conversation.update({ where: { id: cv.id }, data: { lastMessageAt: m.occurredAt } });
    await enqueue("whatsapp.send", { messageId: m.id }, { maxAttempts: 5 }, t);
    if (contactId) await t.activity.create({ data: { type: "WHATSAPP", subject: `WhatsApp şablonu gönderildi: ${tpl.name}`, body, actorId: actor.id, contactId, metadata: { messageId: m.id, template: tpl.name } as Prisma.InputJsonValue } });
    await audit({ actorId: actor.id, action: "whatsapp_send", entityType: "message", entityId: m.id, summary: `${tpl.name} → ${cv.phone ?? cv.externalThreadId}` }, t);
    return m;
  });
}

/** Worker: kuyruktaki şablon mesajını Cloud API'ye gönderir. Kalıcı (4xx) hatada mesaj "Başarısız" olur, yeniden denenmez. */
export async function deliverWhatsappMessage(messageId: string) {
  const msg = await prisma.message.findUnique({ where: { id: messageId }, include: { conversation: true } });
  if (!msg || msg.direction !== "OUTBOUND") throw new Error(`Mesaj bulunamadı: ${messageId}`);
  if (msg.externalMessageId || msg.status === "FAILED" || STATUS_RANK[msg.status] >= STATUS_RANK.SENT) return { skipped: true };
  const fail = (error: string) => prisma.message.update({ where: { id: msg.id }, data: { status: "FAILED", error: error.slice(0, 500) } });
  const tpl = msg.templateId ? await prisma.whatsappTemplate.findUnique({ where: { id: msg.templateId } }) : null;
  if (!tpl || tpl.status !== "APPROVED") {
    await fail("Şablon artık onaylı değil; gönderilmedi.");
    return { failed: true };
  }
  const cfg = whatsappConfig();
  if (!cfg) throw new TokenError("WhatsApp yapılandırılmadı.", "WHATSAPP");
  const params = (Array.isArray(msg.templateParams) ? msg.templateParams : []).map(String);
  await prisma.message.update({ where: { id: msg.id }, data: { status: "SENDING" } });
  let res: { messages?: { id: string }[] };
  try {
    res = await graphRequest(`${cfg.phoneNumberId}/messages`, {
      token: cfg.token,
      method: "POST",
      body: {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: msg.conversation.externalThreadId,
        type: "template",
        template: { name: tpl.name, language: { code: tpl.language }, components: params.length ? [{ type: "body", parameters: params.map((text) => ({ type: "text", text })) }] : [] },
      },
    });
  } catch (e) {
    if (e instanceof GraphError && !e.auth && e.status >= 400 && e.status < 500 && e.status !== 429) {
      await fail(e.message);
      return { failed: true };
    }
    await prisma.message.update({ where: { id: msg.id }, data: { status: "QUEUED", error: e instanceof Error ? e.message.slice(0, 500) : null } });
    return handleProviderError("WHATSAPP", e);
  }
  const wamid = res.messages?.[0]?.id;
  if (!wamid) throw new Error("WhatsApp yanıtında mesaj kimliği yok");
  await prisma.message.update({ where: { id: msg.id }, data: { status: "SENT", externalMessageId: wamid, error: null } });
  await markConnectionOk("WHATSAPP");
  return { sent: true, wamid };
}

/** Gönderim işi kalıcı hataya düştüyse mesajı "Başarısız" işaretle. */
export async function markOutboundDead(messageId: string, error: string) {
  await prisma.message.update({ where: { id: messageId }, data: { status: "FAILED", error: error.slice(0, 500) } }).catch(() => {});
}

// ───────────────────────────── Ekip işlemleri ─────────────────────────────

export async function markConversationRead(actor: Actor, id: string) {
  assertCan(actor, "messages.view");
  await prisma.conversation.update({ where: { id }, data: { unreadCount: 0 } });
}

export async function assignConversation(actor: Actor, id: string, userId: string | null) {
  assertCan(actor, "messages.send");
  if (userId) {
    const u = await prisma.user.findFirst({ where: { id: userId, status: "ACTIVE" }, select: { id: true } });
    if (!u) throw new RuleError("Kullanıcı bulunamadı.");
  }
  await prisma.conversation.update({ where: { id }, data: { assignedUserId: userId } });
  await audit({ actorId: actor.id, action: "conversation_assign", entityType: "conversation", entityId: id, after: { assignedUserId: userId } });
  if (userId && userId !== actor.id) await notify({ userId, type: "message", title: "Bir yazışma size atandı", link: `/mesajlar/${id}` });
}

/** Talep müşteriye dönüştürüldüğünde (Talepler › işle) o talebe bağlı yazışmaları müşteriye bağlar + kanal ekler. */
export async function linkConversationsForLead(t: Prisma.TransactionClient, leadId: string) {
  const convs = await t.conversation.findMany({ where: { leadId, contactId: null } });
  for (const c of convs) await resolveContact(t, c);
}

// ───────────────────────────── Sağlık kontrolü ─────────────────────────────

/** Worker saatte bir: yapılandırılmış Meta anahtarlarını gerçek bir çağrıyla dener (süresi dolmuşsa "Hata" + bildirim). */
export async function metaHealthCheck() {
  const e = env();
  const out: Record<string, string> = {};
  if (e.META_ACCESS_TOKEN && e.META_APP_SECRET) {
    try {
      await graphRequest("me", { token: e.META_ACCESS_TOKEN, query: { fields: "id" }, timeoutMs: 10_000 });
      await markConnectionOk("META_LEAD_ADS");
      out.META_LEAD_ADS = "ok";
    } catch (err) {
      await handleProviderError("META_LEAD_ADS", err).catch(() => {});
      out.META_LEAD_ADS = "error";
    }
  }
  const wa = whatsappConfig();
  if (wa) {
    try {
      const r = await graphRequest<{ display_phone_number?: string; verified_name?: string; quality_rating?: string }>(wa.phoneNumberId, { token: wa.token, query: { fields: "display_phone_number,verified_name,quality_rating" }, timeoutMs: 10_000 });
      await markConnectionOk("WHATSAPP", { displayPhone: r.display_phone_number ?? null, verifiedName: r.verified_name ?? null, quality: r.quality_rating ?? null });
      out.WHATSAPP = "ok";
    } catch (err) {
      await handleProviderError("WHATSAPP", err).catch(() => {});
      out.WHATSAPP = "error";
    }
  }
  return out;
}
