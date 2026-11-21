/**
 * Instagram Conversations API (graph.facebook.com/{ig-account-id}/conversations?platform=instagram) yanıtlarını
 * CRM mesajına çevirir. Saf modül: ağ/DB yok (testlerde doğrudan kullanılır).
 *
 * Kimlik farkları: Graph'taki hesap kimliği (INSTAGRAM_ACCOUNT_ID, 1784…) ile mesajlardaki işletme katılımcısının
 * `from.id` değeri AYNI OLMAYABİLİR (mesajlaşma kapsamlı kimlik). Bu yüzden işletme tarafı iki yoldan tanınır:
 * bilinen kimlik kümesi (hesap kimliği + daha önce öğrenilmiş katılımcı kimlikleri) VEYA kullanıcı adı eşleşmesi.
 * Müşteri kimliği (IGSID) webhook'taki `sender.id` ile aynıdır → yazışma anahtarı (externalThreadId) ortaktır.
 * Mesaj kimliği (`id`) webhook'taki `message.mid` ile aynıdır → aynı mesaj iki yoldan gelse de tek kayıt.
 */

export type IgParticipant = { id?: string; username?: string; name?: string; email?: string };
export type IgGraphMessage = {
  id?: string;
  created_time?: string;
  from?: IgParticipant;
  to?: { data?: IgParticipant[] };
  message?: string;
  attachments?: { data?: Record<string, unknown>[] };
  shares?: { data?: Record<string, unknown>[] };
  story?: Record<string, unknown>;
  is_unsupported?: boolean;
};
export type IgGraphConversation = { id?: string; updated_time?: string };
export type IgPage<T> = { data?: T[]; paging?: { cursors?: { after?: string }; next?: string } };

export type IgSelf = { ids: string[]; username: string | null };

export type IgNormalized = {
  mid: string;
  outbound: boolean;
  customerId: string;
  customerUsername: string | null;
  text: string | null;
  kind: string;
  occurredAt: Date;
};

const MAX_TEXT = 4096;
const ID_RE = /^[A-Za-z0-9_.:=+\-/]{1,512}$/;
export const safeIgId = (v: unknown): string | null => (typeof v === "string" && ID_RE.test(v) ? v : null);
const lc = (s: string | null | undefined) => (s ? s.trim().replace(/^@/, "").toLowerCase() : null);

/** İşletme katılımcısı mı? (bilinen kimlik ya da kullanıcı adı) */
export function isSelf(p: IgParticipant | undefined, self: IgSelf): boolean {
  if (!p) return false;
  if (p.id && self.ids.includes(p.id)) return true;
  const u = lc(p.username);
  return Boolean(u && self.username && u === lc(self.username));
}

const LABEL: Record<string, string> = { image: "Görsel", video: "Video", audio: "Ses kaydı", file: "Dosya", share: "Paylaşım", story_mention: "Hikâye bahsi", story_reply: "Hikâye yanıtı", unsupported: "Desteklenmeyen içerik" };

/** Ek türü: Graph ek nesnesindeki alanlardan çıkarılır (image_data / video_data / audio_data / file_url). */
function attachmentKind(a: Record<string, unknown>): string {
  if (a.image_data) return "image";
  if (a.video_data) return "video";
  if (a.audio_data) return "audio";
  const mime = typeof a.mime_type === "string" ? a.mime_type : "";
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  return "file";
}

export function messageContent(m: IgGraphMessage): { kind: string; text: string | null } {
  const text = typeof m.message === "string" && m.message.trim() ? m.message.slice(0, MAX_TEXT) : null;
  const kinds: string[] = [];
  for (const a of m.attachments?.data ?? []) kinds.push(attachmentKind(a));
  if (m.shares?.data?.length) kinds.push("share");
  if (m.story) kinds.push(m.story.mention ? "story_mention" : "story_reply");
  if (m.is_unsupported && !kinds.length && !text) kinds.push("unsupported");
  if (text) return { kind: "text", text: kinds.length ? `${text} [${kinds.map((k) => LABEL[k] ?? "Ek").join(", ")}]`.slice(0, MAX_TEXT) : text };
  if (kinds.length) return { kind: kinds[0], text: `[${kinds.map((k) => LABEL[k] ?? "Ek").join(", ")}]` };
  return { kind: "unsupported", text: null };
}

/**
 * Graph mesajını CRM mesajına çevirir. Yön: gönderen işletmeyse giden (outbound), değilse gelen.
 * Müşteri: giden mesajda alıcılardan işletme olmayan, gelen mesajda gönderen. Tanınamayan/eksik kayıt null döner.
 */
export function normalizeIgMessage(m: IgGraphMessage, self: IgSelf): IgNormalized | null {
  const mid = safeIgId(m.id);
  const at = m.created_time ? new Date(m.created_time) : null;
  if (!mid || !at || Number.isNaN(at.getTime())) return null;
  const outbound = isSelf(m.from, self);
  const recipients = m.to?.data ?? [];
  // Gelen mesajda alıcı listesinde işletme yoksa bu hesaba ait değildir (ör. grup / başka hesap).
  if (!outbound && recipients.length && !recipients.some((r) => isSelf(r, self))) return null;
  const customer = outbound ? recipients.find((r) => !isSelf(r, self)) : m.from;
  const customerId = safeIgId(customer?.id);
  if (!customerId) return null;
  const { kind, text } = messageContent(m);
  return { mid, outbound, customerId, customerUsername: customer?.username ?? null, text, kind, occurredAt: at };
}

/** İşletmenin mesajlardaki katılımcı kimliklerini öğrenir (kullanıcı adı eşleşmesiyle). */
export function learnSelfIds(messages: IgGraphMessage[], self: IgSelf): string[] {
  const ids = new Set(self.ids);
  for (const m of messages) {
    for (const p of [m.from, ...(m.to?.data ?? [])]) {
      const id = safeIgId(p?.id);
      if (id && self.username && lc(p?.username) === lc(self.username)) ids.add(id);
    }
  }
  return [...ids].slice(0, 20);
}

/** Meta hız sınırı kodları: 4 (uygulama), 17 (kullanıcı), 32 (sayfa), 613 (çağrı sınırı), 80002/80006 (Instagram/Messenger). */
export function isRateLimited(e: { status?: number; code?: number | null }): boolean {
  return e.status === 429 || [4, 17, 32, 613, 80002, 80006].includes(e.code ?? -1);
}

/** Ardışık hatada geri çekilme: 1, 2, 4 … dk, en fazla 60 dk. */
export function syncBackoffMs(failures: number): number {
  return Math.min(60_000 * 2 ** Math.max(0, failures - 1), 3600_000);
}

/** Hata özetini güvenli hale getirir: anahtar/token benzeri parçalar ve URL sorguları atılır. */
export function safeErrorSummary(message: string): string {
  return message
    .replace(/(access_token|token|appsecret_proof|client_secret)=[^&\s]+/gi, "$1=…")
    .replace(/\bEA[A-Za-z0-9]{20,}\b/g, "…")
    .replace(/https?:\/\/\S+/g, (u) => u.split("?")[0])
    .slice(0, 300);
}
