import { randomBytes } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { computeSignature } from "@/lib/integrations/signature";
import { websitePayloadSchema } from "@/lib/integrations/website-payload";
import { acceptWebsitePayload } from "@/lib/services/website-accept";

/**
 * CRM → site çekme. Site CRM'e ulaşamadığında (CRM yerelde / kapalı) form başvurularını CRM kendisi alır.
 *
 *   GET {WEBSITE_PULL_URL}/api/v1/crm/export/requests?after=<ISO>&afterId=<id>&limit=<n>
 *
 * İstek, site → CRM yönündeki imzanın aynısıyla imzalanır (aynı WEBSITE_HMAC_SECRET); imzalanan "gövde"
 * `GET <yol+sorgu>` metnidir. Yanıt: { items: v1 yükleri, next: { after, afterId } | null }.
 * Kaldığı yer (imleç) integration_connections.config.pullCursor içinde tutulur; her sayfadan sonra ilerler.
 * Başvurular submissionId ile tekilleştirilir: site ayrıca POST ile gönderse de çift kayıt açılmaz.
 * Kişisel veri loglanmaz.
 */

export const PULL_PATH = "/api/v1/crm/export/requests";
const PAGE_SIZE = 5;

type Cursor = { after: string; afterId: string };
type Config = { baseUrl: string; secret: string; initialDays: number };

export function websitePullConfig(): Config | null {
  const e = env();
  const baseUrl = (e.WEBSITE_PULL_URL ?? "").replace(/\/+$/, "");
  const secret = e.WEBSITE_HMAC_SECRET ?? "";
  if (!baseUrl || secret.length < 32) return null;
  if (e.APP_ENV === "production" && !baseUrl.startsWith("https://")) return null;
  return { baseUrl, secret, initialDays: e.WEBSITE_PULL_INITIAL_DAYS };
}

export function signedGetHeaders(secret: string, pathAndQuery: string) {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const nonce = randomBytes(18).toString("base64url");
  return {
    "X-Bifire-Timestamp": timestamp,
    "X-Bifire-Nonce": nonce,
    "X-Bifire-Signature": computeSignature(secret, timestamp, nonce, `GET ${pathAndQuery}`),
  };
}

async function readCursor(initialDays: number): Promise<Cursor> {
  const conn = await prisma.integrationConnection.findUnique({ where: { provider: "BIFIRE_WEBSITE" }, select: { config: true } });
  const c = (conn?.config as { pullCursor?: Partial<Cursor> } | null)?.pullCursor;
  if (c?.after && typeof c.afterId === "string") return { after: c.after, afterId: c.afterId };
  return { after: new Date(Date.now() - initialDays * 86_400_000).toISOString(), afterId: "" };
}

async function saveCursor(cursor: Cursor, error: string | null) {
  const conn = await prisma.integrationConnection.findUnique({ where: { provider: "BIFIRE_WEBSITE" }, select: { config: true } });
  const config = { ...((conn?.config as Record<string, unknown> | null) ?? {}), pullCursor: cursor } as Prisma.InputJsonValue;
  const health = error ? { lastErrorAt: new Date(), lastError: error.slice(0, 500) } : { lastSyncAt: new Date(), lastError: null };
  await prisma.integrationConnection.upsert({
    where: { provider: "BIFIRE_WEBSITE" },
    create: { provider: "BIFIRE_WEBSITE", status: error ? "ERROR" : "ACTIVE", config, ...health },
    update: { config, ...(error ? health : { status: "ACTIVE", ...health }) },
  });
}

export type PullResult =
  | { enabled: false }
  | { enabled: true; pages: number; imported: number; duplicates: number; invalid: number; error?: string };

/** Siteden yeni başvuruları çeker. Asla fırlatmaz; sonucu döner. */
export async function pullWebsiteRequests(opts: { maxPages?: number } = {}): Promise<PullResult> {
  const cfg = websitePullConfig();
  if (!cfg) return { enabled: false };
  const out = { enabled: true as const, pages: 0, imported: 0, duplicates: 0, invalid: 0 };
  let cursor = await readCursor(cfg.initialDays);
  try {
    for (let page = 0; page < (opts.maxPages ?? 10); page++) {
      const qs = new URLSearchParams({ after: cursor.after, afterId: cursor.afterId, limit: String(PAGE_SIZE) });
      const pathAndQuery = `${PULL_PATH}?${qs}`;
      const res = await fetch(cfg.baseUrl + pathAndQuery, {
        headers: { Accept: "application/json", ...signedGetHeaders(cfg.secret, pathAndQuery) },
        signal: AbortSignal.timeout(30_000),
        cache: "no-store",
        redirect: "error",
      });
      if (res.status !== 200) {
        const code = ((await res.json().catch(() => null)) as { error?: { code?: string } } | null)?.error?.code ?? "http_error";
        throw new Error(`Site yanıtı ${res.status} ${code}`);
      }
      const body = (await res.json()) as { items?: unknown[]; next?: Cursor | null };
      out.pages++;
      for (const raw of body.items ?? []) {
        const parsed = websitePayloadSchema.safeParse(raw);
        if (!parsed.success) {
          out.invalid++;
          continue;
        }
        const r = await acceptWebsitePayload(parsed.data, "pull");
        // Kayıt hatası: imleci bu başvurunun ötesine taşımadan dur; sonraki turda yeniden denenir.
        if (!r.ok) throw new Error(`Başvuru kaydedilemedi (${r.error})`);
        if (r.duplicate) out.duplicates++;
        else out.imported++;
        cursor = { after: parsed.data.submittedAt, afterId: parsed.data.submissionId };
      }
      if (body.next) cursor = body.next;
      await saveCursor(cursor, null);
      if (!body.next) break;
    }
    return out;
  } catch (e) {
    const error = e instanceof Error ? (e.name === "TimeoutError" ? "Site zaman aşımı" : e.message) : "Bilinmeyen hata";
    await saveCursor(cursor, `Çekme: ${error}`).catch(() => {});
    return { ...out, error };
  }
}
