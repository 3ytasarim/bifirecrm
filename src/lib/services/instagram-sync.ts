import "server-only";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { GraphError, graphRequest } from "@/lib/integrations/graph";
import { markConnectionError } from "@/lib/integrations/health";
import {
  type IgGraphConversation,
  type IgGraphMessage,
  type IgPage,
  type IgSelf,
  isRateLimited,
  learnSelfIds,
  normalizeIgMessage,
  safeErrorSummary,
  safeIgId,
  syncBackoffMs,
} from "@/lib/integrations/instagram-conversations";
import { recordInbound } from "./channels";

/**
 * Instagram DM senkronu (Conversations API) — webhook'un YEDEĞİ. Webhook kaldırılmaz; ikisi birlikte çalışır.
 * Aynı mesaj iki yoldan gelirse (yazışma, mesaj kimliği) tekilliği ile tek kayıt kalır.
 *
 *  - Kilit: integration_connections(INSTAGRAM_DM).config.igSyncLock — tek SQL koşullu güncellemeyle alınır (kira, 5 dk).
 *    Dakikalık pm2 worker ile cron'daki `worker --once` aynı anda çalışsa bile tek senkron yürür.
 *  - Durum: config.igSync — görüşme başına işlenmiş `updated_time`, işletme kimliği, hata sayacı, geri çekilme.
 *    Yalnız `igSync`/`igSyncLock` anahtarları yazılır; config'teki diğer alanlara dokunulmaz.
 *  - İlk senkron: son güncellenen görüşmeler (en fazla 100) ve her birinin erişilebilir son 20 mesajı. Meta, mesaj
 *    ayrıntısını yalnız son 20 mesaj için verir. 24 saatten eski mesajlar sessiz eklenir (bildirim/talep açılmaz).
 *  - Sonrakiler: yalnız `updated_time`'ı değişen görüşmeler okunur.
 *  - Hata: mesaj SİLİNMEZ; işlenen görüşmeye kadar ilerleme saklanır. Anahtar/izin hatası → bağlantı "Hata" +
 *    yönetici bildirimi; hız sınırı / ağ hatası → üstel geri çekilme (1 → 60 dk).
 *  - Durum "Aktif" yalnız başarılı bir API senkronundan sonra yazılır.
 *  - Loglanmaz: token, sır, mesaj içeriği, kullanıcı adı/kimlikleri.
 */

const PROVIDER = "INSTAGRAM_DM" as const;
const LOCK_MS = 5 * 60_000;
const QUIET_OLDER_THAN_MS = 24 * 3600_000;
const SELF_REFRESH_MS = 24 * 3600_000;
const MESSAGE_LIMIT = 20;
const CONV_PAGE = 25;
const MAX_TRACKED = 500;
const FULL_FIELDS = "id,created_time,from,to,message,attachments,shares,story,is_unsupported";
const BASIC_FIELDS = "id,created_time,from,to,message";

export type IgSyncState = {
  self?: { username: string | null; ids: string[]; checkedAt: string };
  /** görüşme kimliği → işlenmiş updated_time */
  conversations?: Record<string, string>;
  /** Tam turda işlenen en yeni görüşme zamanı; daha eskilerde sayfalama durur. */
  watermark?: string | null;
  initialDoneAt?: string | null;
  lastRunAt?: string;
  lastSuccessAt?: string | null;
  lastError?: string | null;
  lastErrorAt?: string | null;
  failures?: number;
  backoffUntil?: string | null;
  basicFieldsOnly?: boolean;
  lastStats?: { conversations: number; messages: number; added: number; duplicates: number };
};

export type IgSyncResult =
  | { enabled: false; reason: string }
  | { enabled: true; skipped: "locked" | "backoff"; until?: string }
  | { enabled: true; skipped?: undefined; conversations: number; messages: number; added: number; duplicates: number; truncated: boolean; error?: string };

export function instagramSyncConfig(): { token: string; accountId: string } | null {
  const e = env();
  if (!e.META_ACCESS_TOKEN || !e.INSTAGRAM_ACCOUNT_ID) return null;
  return { token: e.META_ACCESS_TOKEN, accountId: e.INSTAGRAM_ACCOUNT_ID };
}

// ───────────── Durum + kilit (yalnız config.igSync / config.igSyncLock) ─────────────

async function ensureRow() {
  await prisma.integrationConnection.upsert({ where: { provider: PROVIDER }, create: { provider: PROVIDER, status: "NOT_CONFIGURED" }, update: {} });
}

export async function acquireSyncLock(owner: string, now = new Date()): Promise<boolean> {
  await ensureRow();
  const until = new Date(now.getTime() + LOCK_MS).toISOString();
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    UPDATE integration_connections
    SET config = jsonb_set(COALESCE(config, '{}'::jsonb), '{igSyncLock}', jsonb_build_object('owner', ${owner}::text, 'until', ${until}::text)), "updatedAt" = now()
    WHERE provider = 'INSTAGRAM_DM'
      AND (config IS NULL OR config->'igSyncLock' IS NULL OR (config->'igSyncLock'->>'until')::timestamptz < ${now.toISOString()}::timestamptz)
    RETURNING id::text AS id`;
  return rows.length === 1;
}

export async function releaseSyncLock(owner: string) {
  await prisma.$executeRaw`
    UPDATE integration_connections SET config = config - 'igSyncLock', "updatedAt" = now()
    WHERE provider = 'INSTAGRAM_DM' AND config->'igSyncLock'->>'owner' = ${owner}::text`;
}

export async function readSyncState(): Promise<IgSyncState> {
  const c = await prisma.integrationConnection.findUnique({ where: { provider: PROVIDER }, select: { config: true } });
  return ((c?.config as { igSync?: IgSyncState } | null)?.igSync ?? {}) as IgSyncState;
}

async function writeSyncState(state: IgSyncState) {
  const conv = Object.entries(state.conversations ?? {})
    .sort((a, b) => (a[1] < b[1] ? 1 : -1))
    .slice(0, MAX_TRACKED);
  const json = JSON.stringify({ ...state, conversations: Object.fromEntries(conv) });
  await prisma.$executeRaw`
    UPDATE integration_connections SET config = jsonb_set(COALESCE(config, '{}'::jsonb), '{igSync}', ${json}::jsonb), "updatedAt" = now()
    WHERE provider = 'INSTAGRAM_DM'`;
}

// ───────────── Graph çağrıları ─────────────

async function loadSelf(cfg: { token: string; accountId: string }, state: IgSyncState, now: Date): Promise<IgSelf> {
  const fresh = state.self && now.getTime() - new Date(state.self.checkedAt).getTime() < SELF_REFRESH_MS;
  if (fresh && state.self) return { ids: [...new Set([cfg.accountId, ...state.self.ids])], username: state.self.username };
  const me = await graphRequest<{ id?: string; username?: string }>(cfg.accountId, { token: cfg.token, query: { fields: "id,username" }, timeoutMs: 15_000 });
  const ids = [...new Set([cfg.accountId, ...(safeIgId(me.id) ? [me.id!] : []), ...(state.self?.ids ?? [])])];
  state.self = { username: me.username ?? state.self?.username ?? null, ids, checkedAt: now.toISOString() };
  return { ids, username: state.self.username };
}

async function listMessages(token: string, conversationId: string, state: IgSyncState): Promise<IgGraphMessage[]> {
  const get = (fields: string) => graphRequest<IgPage<IgGraphMessage>>(`${conversationId}/messages`, { token, query: { fields, limit: String(MESSAGE_LIMIT) }, timeoutMs: 20_000 });
  if (state.basicFieldsOnly) return (await get(BASIC_FIELDS)).data ?? [];
  try {
    return (await get(FULL_FIELDS)).data ?? [];
  } catch (e) {
    // 100: geçersiz alan (ek alanları bu hesapta desteklenmiyor) → temel alanlarla devam, sonraki turlarda da öyle.
    if (e instanceof GraphError && e.code === 100) {
      state.basicFieldsOnly = true;
      return (await get(BASIC_FIELDS)).data ?? [];
    }
    throw e;
  }
}

// ───────────── Senkron ─────────────

export async function syncInstagramConversations(opts: { owner: string; now?: Date; maxPages?: number; timeBudgetMs?: number } = { owner: "worker" }): Promise<IgSyncResult> {
  const cfg = instagramSyncConfig();
  if (!cfg) return { enabled: false, reason: "META_ACCESS_TOKEN / INSTAGRAM_ACCOUNT_ID tanımlı değil" };
  const now = opts.now ?? new Date();
  const started = Date.now();
  const budget = opts.timeBudgetMs ?? 90_000;

  const pre = await readSyncState();
  if (pre.backoffUntil && new Date(pre.backoffUntil) > now) return { enabled: true, skipped: "backoff", until: pre.backoffUntil };
  if (!(await acquireSyncLock(opts.owner, now))) return { enabled: true, skipped: "locked" };

  const state = await readSyncState();
  state.conversations ??= {};
  state.lastRunAt = now.toISOString();
  const stats = { conversations: 0, messages: 0, added: 0, duplicates: 0 };
  let truncated = false;
  let newestSeen: string | null = null;
  try {
    const self = await loadSelf(cfg, state, now);
    const maxPages = opts.maxPages ?? (state.initialDoneAt ? 2 : 4);
    let after: string | undefined;
    pages: for (let page = 0; page < maxPages; page++) {
      const q: Record<string, string> = { platform: "instagram", fields: "id,updated_time", limit: String(CONV_PAGE) };
      if (after) q.after = after;
      const res = await graphRequest<IgPage<IgGraphConversation>>(`${cfg.accountId}/conversations`, { token: cfg.token, query: q, timeoutMs: 20_000 });
      for (const c of res.data ?? []) {
        const id = safeIgId(c.id);
        const updated = typeof c.updated_time === "string" ? c.updated_time : null;
        if (!id || !updated) continue;
        if (!newestSeen || updated > newestSeen) newestSeen = updated;
        // Liste en yeniden eskiye sıralı: önceki tam turun en yenisinden eski görüşmelere inmeye gerek yok.
        if (state.watermark && updated < state.watermark) break pages;
        if (state.conversations[id] === updated) continue;
        if (Date.now() - started > budget) {
          truncated = true;
          break pages;
        }
        const raw = await listMessages(cfg.token, id, state);
        // İşletmenin mesajlaşma kimliği hesap kimliğinden farklı olabilir: kullanıcı adıyla öğren.
        self.ids = learnSelfIds(raw, self);
        if (state.self) state.self.ids = self.ids;
        const msgs = raw.map((m) => normalizeIgMessage(m, self)).filter((m): m is NonNullable<typeof m> => m !== null);
        msgs.sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
        const customer = msgs.find((m) => m.customerUsername)?.customerUsername ?? null;
        for (const m of msgs) {
          const r = await recordInbound({
            channel: "INSTAGRAM",
            threadId: m.customerId,
            displayName: customer ? `@${customer}` : null,
            phone: null,
            externalMessageId: m.mid,
            kind: m.kind,
            text: m.text,
            occurredAt: m.occurredAt,
            outbound: m.outbound,
            quiet: now.getTime() - m.occurredAt.getTime() > QUIET_OLDER_THAN_MS,
          });
          stats.messages++;
          if (r.duplicate) stats.duplicates++;
          else stats.added++;
        }
        stats.conversations++;
        // İlerleme görüşme başına saklanır: sonraki hata bu görüşmeyi yeniden okutmaz.
        state.conversations[id] = updated;
        await writeSyncState(state);
      }
      after = res.paging?.next ? res.paging.cursors?.after : undefined;
      if (!after) break;
      if (page === maxPages - 1) truncated = true;
    }

    // Zaman çizgisi yalnız TAM turda ilerler (yarıda kalan turda atlanan görüşme kaybolmasın).
    if (!truncated && newestSeen && (!state.watermark || newestSeen > state.watermark)) state.watermark = newestSeen;
    state.initialDoneAt ??= now.toISOString();
    Object.assign(state, { lastSuccessAt: now.toISOString(), lastError: null, lastErrorAt: null, failures: 0, backoffUntil: null, lastStats: stats });
    await writeSyncState(state);
    // Gerçek, başarılı API senkronu → Aktif. (Anahtarların varlığı tek başına başarı sayılmaz.)
    await prisma.integrationConnection.update({ where: { provider: PROVIDER }, data: { status: "ACTIVE", lastSyncAt: now, lastError: null } });
    return { enabled: true, ...stats, truncated };
  } catch (e) {
    const failures = (state.failures ?? 0) + 1;
    const summary = safeErrorSummary(e instanceof Error ? e.message : String(e));
    const auth = e instanceof GraphError && e.auth;
    const limited = e instanceof GraphError && isRateLimited(e);
    const wait = syncBackoffMs(limited ? Math.max(failures, 3) : failures);
    Object.assign(state, { failures, lastError: summary, lastErrorAt: now.toISOString(), backoffUntil: new Date(now.getTime() + wait).toISOString(), lastStats: stats });
    await writeSyncState(state).catch(() => {});
    if (auth) await markConnectionError(PROVIDER, `Instagram API senkronu: ${summary}`).catch(() => {});
    else await prisma.integrationConnection.update({ where: { provider: PROVIDER }, data: { lastErrorAt: now, lastError: `Instagram API senkronu: ${summary}` } }).catch(() => {});
    return { enabled: true, ...stats, truncated: true, error: limited ? `Hız sınırı: ${summary}` : summary };
  } finally {
    await releaseSyncLock(opts.owner).catch(() => {});
  }
}

/** Kurulum kontrolü (salt okunur): alanların gerçek yanıtta gelip gelmediğini sayılarla raporlar — içerik/kimlik yok. */
export async function checkInstagramFields() {
  const cfg = instagramSyncConfig();
  if (!cfg) return { ok: false, error: "yapılandırılmadı" };
  const state = await readSyncState();
  const self = await loadSelf(cfg, { ...state, self: undefined }, new Date());
  const convs = await graphRequest<IgPage<IgGraphConversation>>(`${cfg.accountId}/conversations`, { token: cfg.token, query: { platform: "instagram", fields: "id,updated_time", limit: "5" }, timeoutMs: 20_000 });
  const first = convs.data?.[0];
  if (!first?.id) return { ok: true, usernameResolved: Boolean(self.username), conversations: 0 };
  const raw = await listMessages(cfg.token, first.id, { ...state });
  const has = (k: keyof IgGraphMessage) => raw.filter((m) => m[k] !== undefined).length;
  const selfIds = learnSelfIds(raw, self);
  const norm = raw.map((m) => normalizeIgMessage(m, { ...self, ids: selfIds }));
  return {
    ok: true,
    usernameResolved: Boolean(self.username),
    conversations: convs.data?.length ?? 0,
    pagingCursor: Boolean(convs.paging?.cursors?.after),
    messages: raw.length,
    fields: { id: has("id"), created_time: has("created_time"), from: has("from"), to: has("to"), message: has("message"), attachments: has("attachments"), shares: has("shares"), story: has("story") },
    fromHasUsername: raw.filter((m) => m.from?.username).length,
    businessIdDiffersFromAccountId: selfIds.some((i) => i !== cfg.accountId),
    normalized: norm.filter(Boolean).length,
    outbound: norm.filter((m) => m?.outbound).length,
    inbound: norm.filter((m) => m && !m.outbound).length,
    extendedFields: !(state.basicFieldsOnly ?? false),
  };
}

