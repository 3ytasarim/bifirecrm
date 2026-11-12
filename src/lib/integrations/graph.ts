import "server-only";
import { env } from "@/lib/env";

/**
 * Meta Graph API istemcisi. Erişim anahtarı URL'ye değil Authorization başlığına konur (günlüklere sızmasın).
 * Hata yanıtları GraphError'a çevrilir; anahtar süresi dolmuş/iptal edilmiş ya da izin eksikse `auth = true`
 * olur → çağıran bağlantıyı "Hata" durumuna alıp yöneticilere bildirir (integrations/health.ts).
 */
export class GraphError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: number | null,
    readonly subcode: number | null,
  ) {
    super(message);
    this.name = "GraphError";
  }
  /** 190: geçersiz/süresi dolmuş anahtar · 102: oturum · 10 ve 200–299: izin. */
  get auth() {
    const c = this.code ?? -1;
    return c === 190 || c === 102 || c === 10 || (c >= 200 && c <= 299) || this.status === 401;
  }
}

export function graphBase() {
  const e = env();
  const override = e.APP_ENV !== "production" ? e.META_GRAPH_URL : undefined;
  return `${(override ?? "https://graph.facebook.com").replace(/\/$/, "")}/${e.META_GRAPH_VERSION}`;
}

export async function graphRequest<T>(path: string, opts: { token: string; method?: "GET" | "POST" | "DELETE"; query?: Record<string, string>; body?: unknown; timeoutMs?: number }): Promise<T> {
  const url = new URL(`${graphBase()}/${path.replace(/^\//, "")}`);
  for (const [k, v] of Object.entries(opts.query ?? {})) url.searchParams.set(k, v);
  let res: Response;
  try {
    res = await fetch(url, {
      method: opts.method ?? "GET",
      headers: { Authorization: `Bearer ${opts.token}`, ...(opts.body ? { "Content-Type": "application/json" } : {}) },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      signal: AbortSignal.timeout(opts.timeoutMs ?? 15_000),
      cache: "no-store",
    });
  } catch (e) {
    throw new GraphError(`Graph API'ye ulaşılamadı: ${e instanceof Error ? e.message : "ağ hatası"}`, 0, null, null);
  }
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* JSON olmayan yanıt */
  }
  if (!res.ok) {
    const err = (json as { error?: { message?: string; code?: number; error_subcode?: number } } | null)?.error;
    // Mesaj sağlayıcıdan gelir; anahtar içermez. Uzunluk sınırlı.
    throw new GraphError(`Graph API ${res.status}${err?.code ? ` (kod ${err.code})` : ""}: ${(err?.message ?? text ?? "").slice(0, 300)}`, res.status, err?.code ?? null, err?.error_subcode ?? null);
  }
  return json as T;
}
