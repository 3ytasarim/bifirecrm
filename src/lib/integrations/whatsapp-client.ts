import "server-only";
import { env } from "@/lib/env";
import { GraphError, graphRequest } from "@/lib/integrations/graph";
import type { WhatsappConfig } from "@/lib/integrations/channels-config";

/**
 * WhatsApp gönderim/şablon/sağlık çağrıları — sağlayıcıdan bağımsız.
 *  - meta:      graph.facebook.com/{sürüm}/{phone_number_id}/messages, {waba_id}/message_templates (Bearer).
 *  - 360dialog: waba-v2.360dialog.io/messages, /message_templates (D360-API-KEY başlığı). Gövde/yanıt biçimi
 *               Cloud API ile aynıdır; anahtar tek numaraya bağlı olduğu için yolda kimlik yoktur.
 * Hatalar her iki sağlayıcıda GraphError'a çevrilir (auth → bağlantı "Hata" + yöneticilere bildirim).
 */

export type WaTemplate = { id: string; name: string; language: string; status: string; category: string; components?: unknown[] };
type TemplatePage = { data?: WaTemplate[]; paging?: { cursors?: { after?: string }; next?: string } };

export function d360Base() {
  const e = env();
  const override = e.APP_ENV !== "production" ? e.D360_API_URL : undefined;
  return (override ?? "https://waba-v2.360dialog.io").replace(/\/$/, "");
}

export async function d360Request<T>(path: string, opts: { apiKey: string; method?: "GET" | "POST"; query?: Record<string, string>; body?: unknown; timeoutMs?: number }): Promise<T> {
  const url = new URL(`${d360Base()}/${path.replace(/^\//, "")}`);
  for (const [k, v] of Object.entries(opts.query ?? {})) url.searchParams.set(k, v);
  let res: Response;
  try {
    res = await fetch(url, {
      method: opts.method ?? "GET",
      headers: { "D360-API-KEY": opts.apiKey, Accept: "application/json", ...(opts.body ? { "Content-Type": "application/json" } : {}) },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      signal: AbortSignal.timeout(opts.timeoutMs ?? 15_000),
      cache: "no-store",
      redirect: "error",
    });
  } catch (e) {
    throw new GraphError(`360dialog'a ulaşılamadı: ${e instanceof Error ? e.message : "ağ hatası"}`, 0, null, null);
  }
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* JSON olmayan yanıt */
  }
  if (!res.ok) {
    // 360dialog Cloud API hatalarını Meta biçiminde ({ error: { code, message } }) iletir; kendi hataları farklı olabilir.
    const j = json as { error?: { message?: string; code?: number; error_subcode?: number } | string; meta?: { developer_message?: string } } | null;
    const err = typeof j?.error === "object" ? j.error : null;
    const msg = err?.message ?? (typeof j?.error === "string" ? j.error : null) ?? j?.meta?.developer_message ?? text ?? "";
    // 401/403 → anahtar geçersiz/iptal: GraphError.auth bunu status ile yakalar.
    throw new GraphError(`360dialog ${res.status}${err?.code ? ` (kod ${err.code})` : ""}: ${String(msg).slice(0, 300)}`, res.status, err?.code ?? (res.status === 403 ? 10 : null), err?.error_subcode ?? null);
  }
  return json as T;
}

/** Mesaj gönderir (Cloud API gövdesi); WhatsApp mesaj kimliğini (wamid) döner. */
export async function waSendMessage(cfg: WhatsappConfig, body: Record<string, unknown>): Promise<string | null> {
  const payload = { messaging_product: "whatsapp", recipient_type: "individual", ...body };
  const res =
    cfg.provider === "360dialog"
      ? await d360Request<{ messages?: { id: string }[] }>("messages", { apiKey: cfg.apiKey, method: "POST", body: payload })
      : await graphRequest<{ messages?: { id: string }[] }>(`${cfg.phoneNumberId}/messages`, { token: cfg.token, method: "POST", body: payload });
  return res.messages?.[0]?.id ?? null;
}

/** Tüm şablonlar (sayfalı). */
export async function waListTemplates(cfg: WhatsappConfig): Promise<WaTemplate[]> {
  const all: WaTemplate[] = [];
  let after: string | undefined;
  for (let page = 0; page < 20; page++) {
    const query = { fields: "id,name,language,status,category,components", limit: "100", ...(after ? { after } : {}) };
    const r =
      cfg.provider === "360dialog"
        ? await d360Request<TemplatePage>("message_templates", { apiKey: cfg.apiKey, query })
        : await graphRequest<TemplatePage>(`${cfg.wabaId}/message_templates`, { token: cfg.token, query });
    all.push(...(r.data ?? []));
    after = r.paging?.next ? r.paging.cursors?.after : undefined;
    if (!after) break;
  }
  return all;
}

/** Anahtarı gerçek bir çağrıyla dener. Meta'da numara bilgisini de döner. */
export async function waHealth(cfg: WhatsappConfig): Promise<{ displayPhone: string | null; verifiedName: string | null; quality: string | null }> {
  if (cfg.provider === "360dialog") {
    await d360Request("message_templates", { apiKey: cfg.apiKey, query: { limit: "1" }, timeoutMs: 10_000 });
    return { displayPhone: null, verifiedName: null, quality: null };
  }
  const r = await graphRequest<{ display_phone_number?: string; verified_name?: string; quality_rating?: string }>(cfg.phoneNumberId, {
    token: cfg.token,
    query: { fields: "display_phone_number,verified_name,quality_rating" },
    timeoutMs: 10_000,
  });
  return { displayPhone: r.display_phone_number ?? null, verifiedName: r.verified_name ?? null, quality: r.quality_rating ?? null };
}
