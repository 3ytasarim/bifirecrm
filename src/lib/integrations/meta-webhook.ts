import type { IntegrationProvider } from "@prisma/client";

/**
 * Meta webhook gövdesini (Lead Ads, Instagram mesajları, WhatsApp Cloud API) tek tek olaylara ayırır.
 * Saf fonksiyon: ağ/DB yok. Her olayın sağlayıcı kimliğinden türetilmiş tekil bir anahtarı vardır →
 * Meta aynı bildirimi yeniden gönderse de integration_events (provider, externalEventId) tekilliği ile bir kez işlenir.
 */
export type MetaJobType = "meta.leadgen" | "instagram.message" | "whatsapp.message" | "whatsapp.status" | "whatsapp.sync_templates";

export type ParsedMetaEvent = {
  provider: IntegrationProvider;
  externalEventId: string;
  eventType: string;
  jobType: MetaJobType;
  payload: Record<string, unknown>;
};

export type LeadgenPayload = { leadgenId: string; formId: string | null; adId: string | null; pageId: string | null; createdTime: number | null };
export type InstagramMessagePayload = { mid: string; accountId: string; igUserId: string; fromBusiness: boolean; text: string | null; kind: string; timestamp: number };
export type WhatsappMessagePayload = { id: string; waId: string; name: string | null; kind: string; text: string | null; timestamp: number; phoneNumberId: string | null };
export type WhatsappStatusPayload = { id: string; status: string; recipientId: string | null; timestamp: number; error: string | null };

const MAX_TEXT = 4096;
type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : null);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : typeof v === "number" ? String(v) : null);
const num = (v: unknown): number | null => {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? n : null;
};
const clip = (s: string | null) => (s ? s.slice(0, MAX_TEXT) : null);
/** Kimlikler URL/anahtar olarak kullanılır: yalnız güvenli karakterler, makul uzunluk. */
const safeId = (v: unknown): string | null => {
  const s = str(v);
  return s && /^[A-Za-z0-9_.:=+\-/]{1,200}$/.test(s) ? s : null;
};

function whatsappSummary(m: Obj): { kind: string; text: string | null } {
  const kind = str(m.type) ?? "unknown";
  const pick = (k: string) => obj(m[k]);
  switch (kind) {
    case "text":
      return { kind, text: clip(str(pick("text")?.body)) };
    case "image":
    case "video":
    case "document":
    case "sticker":
    case "audio": {
      const label = { image: "Görsel", video: "Video", document: "Belge", sticker: "Çıkartma", audio: "Ses kaydı" }[kind];
      const caption = str(pick(kind)?.caption) ?? str(pick(kind)?.filename);
      return { kind, text: clip(`[${label}]${caption ? ` ${caption}` : ""}`) };
    }
    case "location": {
      const l = pick("location");
      return { kind, text: clip(`[Konum] ${[str(l?.name), str(l?.address)].filter(Boolean).join(", ") || `${num(l?.latitude) ?? "?"}, ${num(l?.longitude) ?? "?"}`}`) };
    }
    case "button":
      return { kind, text: clip(str(pick("button")?.text)) };
    case "interactive": {
      const i = pick("interactive");
      return { kind, text: clip(str(obj(i?.button_reply)?.title) ?? str(obj(i?.list_reply)?.title)) };
    }
    case "reaction":
      return { kind, text: clip(`[Tepki] ${str(pick("reaction")?.emoji) ?? ""}`.trim()) };
    case "contacts":
      return { kind, text: "[Kişi kartı]" };
    default:
      return { kind: "unsupported", text: "[Desteklenmeyen mesaj türü]" };
  }
}

export function parseMetaWebhook(body: unknown, opts: { whatsappPhoneNumberId?: string | null } = {}): ParsedMetaEvent[] {
  const root = obj(body);
  if (!root) return [];
  const object = str(root.object);
  const out: ParsedMetaEvent[] = [];

  for (const entryRaw of arr(root.entry)) {
    const entry = obj(entryRaw);
    if (!entry) continue;
    const entryId = safeId(entry.id);

    // ── Facebook sayfası: Lead Ads (leadgen)
    if (object === "page") {
      for (const chRaw of arr(entry.changes)) {
        const ch = obj(chRaw);
        if (str(ch?.field) !== "leadgen") continue;
        const v = obj(ch?.value);
        const leadgenId = safeId(v?.leadgen_id);
        if (!leadgenId) continue;
        const payload: LeadgenPayload = { leadgenId, formId: safeId(v?.form_id), adId: safeId(v?.ad_id), pageId: safeId(v?.page_id) ?? entryId, createdTime: num(v?.created_time) };
        out.push({ provider: "META_LEAD_ADS", externalEventId: `leadgen:${leadgenId}`, eventType: "leadgen", jobType: "meta.leadgen", payload });
      }
    }

    // ── Instagram mesajları (Instagram API / Messenger Platform)
    if (object === "instagram") {
      for (const mRaw of arr(entry.messaging)) {
        const m = obj(mRaw);
        const msg = obj(m?.message);
        const mid = safeId(msg?.mid);
        if (!m || !msg || !mid || msg.is_deleted) continue;
        const sender = safeId(obj(m.sender)?.id);
        const recipient = safeId(obj(m.recipient)?.id);
        const fromBusiness = msg.is_echo === true;
        const igUserId = fromBusiness ? recipient : sender;
        const accountId = (fromBusiness ? sender : recipient) ?? entryId;
        if (!igUserId || !accountId) continue;
        const attachments = arr(msg.attachments).map((a) => str(obj(a)?.type) ?? "file");
        const text = clip(str(msg.text) ?? (attachments.length ? `[${attachments.map((t) => ({ image: "Görsel", video: "Video", audio: "Ses kaydı", share: "Paylaşım", story_mention: "Hikâye bahsi", ig_reel: "Reels" })[t] ?? "Ek").join(", ")}]` : null));
        const payload: InstagramMessagePayload = { mid, accountId, igUserId, fromBusiness, text, kind: str(msg.text) ? "text" : attachments[0] ?? "unsupported", timestamp: num(m.timestamp) ?? Date.now() };
        out.push({ provider: "INSTAGRAM_DM", externalEventId: `ig:${mid}`, eventType: fromBusiness ? "message.echo" : "message", jobType: "instagram.message", payload });
      }
    }

    // ── WhatsApp Cloud API
    if (object === "whatsapp_business_account") {
      for (const chRaw of arr(entry.changes)) {
        const ch = obj(chRaw);
        const field = str(ch?.field);
        const v = obj(ch?.value);
        if (!v) continue;
        if (field === "message_template_status_update") {
          const tid = safeId(v.message_template_id) ?? "unknown";
          out.push({ provider: "WHATSAPP", externalEventId: `wa-template:${tid}:${str(v.event) ?? "?"}:${num(entry.time) ?? 0}`, eventType: "template_status", jobType: "whatsapp.sync_templates", payload: { templateId: tid, event: str(v.event), name: str(v.message_template_name) } });
          continue;
        }
        if (field !== "messages") continue;
        const phoneNumberId = safeId(obj(v.metadata)?.phone_number_id);
        // Aynı uygulamaya bağlı başka bir numaranın olayları bu CRM'e ait değildir.
        if (opts.whatsappPhoneNumberId && phoneNumberId && phoneNumberId !== opts.whatsappPhoneNumberId) continue;
        const names = new Map<string, string>();
        for (const c of arr(v.contacts)) {
          const co = obj(c);
          const wa = safeId(co?.wa_id);
          const name = str(obj(co?.profile)?.name);
          if (wa && name) names.set(wa, name.slice(0, 200));
        }
        for (const mRaw of arr(v.messages)) {
          const m = obj(mRaw);
          const id = safeId(m?.id);
          const waId = str(m?.from);
          if (!m || !id || !waId || !/^\d{6,15}$/.test(waId)) continue;
          const { kind, text } = whatsappSummary(m);
          const payload: WhatsappMessagePayload = { id, waId, name: names.get(waId) ?? null, kind, text, timestamp: (num(m.timestamp) ?? Math.floor(Date.now() / 1000)) * 1000, phoneNumberId };
          out.push({ provider: "WHATSAPP", externalEventId: `wa:${id}`, eventType: `message.${kind}`, jobType: "whatsapp.message", payload });
        }
        for (const sRaw of arr(v.statuses)) {
          const s = obj(sRaw);
          const id = safeId(s?.id);
          const status = str(s?.status);
          if (!s || !id || !status || !/^[a-z_]{3,20}$/.test(status)) continue;
          const err = obj(arr(s.errors)[0]);
          const error = err ? `${num(err.code) ?? "?"}: ${str(err.title) ?? str(err.message) ?? "hata"}`.slice(0, 500) : null;
          const payload: WhatsappStatusPayload = { id, status, recipientId: str(s.recipient_id), timestamp: (num(s.timestamp) ?? Math.floor(Date.now() / 1000)) * 1000, error };
          out.push({ provider: "WHATSAPP", externalEventId: `wa-status:${id}:${status}`, eventType: `status.${status}`, jobType: "whatsapp.status", payload });
        }
      }
    }
  }
  return out;
}
