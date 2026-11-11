import "server-only";
import { createHmac, randomBytes } from "node:crypto";
import { after } from "next/server";
import { prisma } from "@/lib/db";
import { privateStorage } from "@/lib/storage/private";

/**
 * Site → Bifire CRM (crm.bifiresomine.com) aktarımı.
 *
 * Güvenlik/geri alınabilirlik:
 *  - Varsayılan KAPALI: CRM_FORWARD_ENABLED=true olmadıkça hiçbir istek yapılmaz; site davranışı birebir aynı kalır.
 *  - Talep önce sitenin kendi DB'sine yazılır (ContactRequest = tek gerçek kaynak). Aktarım yanıttan SONRA
 *    yapılır (`after`), ziyaretçi beklemez; CRM kapalı/yavaş olsa da form akışı bozulmaz.
 *  - Kaçan aktarımlar `npm run crm:forward` (cron) ile mutabakatla yeniden gönderilir; CRM submissionId ile
 *    tekilleştirir, aynı talep iki kez kayıt açmaz.
 *  - İstekler HMAC-SHA256 ile imzalanır (zaman damgası + tek kullanımlık nonce). Sır yalnız sunucuda (.env).
 *
 * İmza (CRM'deki src/lib/integrations/signature.ts ile aynı):
 *   X-Bifire-Signature = "v1=" + hex(HMAC-SHA256(CRM_WEBSITE_HMAC_SECRET, `${timestamp}.${nonce}.${rawBody}`))
 */

type Config = { baseUrl: string; secret: string };

export function crmForwardConfig(): Config | null {
  if (process.env.CRM_FORWARD_ENABLED !== "true") return null;
  const baseUrl = (process.env.CRM_INTAKE_URL ?? "").replace(/\/+$/, "");
  const secret = process.env.CRM_WEBSITE_HMAC_SECRET ?? "";
  if (!/^https?:\/\//.test(baseUrl) || secret.length < 32) {
    console.error("[crm-forward] CRM_FORWARD_ENABLED=true ama CRM_INTAKE_URL / CRM_WEBSITE_HMAC_SECRET eksik veya geçersiz.");
    return null;
  }
  if (process.env.NODE_ENV === "production" && !baseUrl.startsWith("https://")) {
    console.error("[crm-forward] Production'da CRM_INTAKE_URL https olmalı; aktarım yapılmadı.");
    return null;
  }
  return { baseUrl, secret };
}

export type ForwardResult = { ok: true; duplicate: boolean } | { ok: false; status?: number; error: string };

async function signedPost(cfg: Config, path: string, body: unknown, timeoutMs: number): Promise<{ status: number; json: unknown }> {
  const raw = JSON.stringify(body);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const nonce = randomBytes(18).toString("base64url");
  const signature = "v1=" + createHmac("sha256", cfg.secret).update(`${timestamp}.${nonce}.${raw}`).digest("hex");
  const res = await fetch(cfg.baseUrl + path, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Bifire-Timestamp": timestamp, "X-Bifire-Nonce": nonce, "X-Bifire-Signature": signature },
    body: raw,
    signal: AbortSignal.timeout(timeoutMs),
    cache: "no-store",
    redirect: "error",
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}

/** ContactRequest → CRM yükü (sürüm 1). Fotoğraflar özel depodan okunur ve base64 olarak eklenir. */
async function buildPayload(requestId: string) {
  const r = await prisma.contactRequest.findUnique({ where: { id: requestId }, include: { attachments: true } });
  if (!r) return null;
  const attachments: { name: string; mimeType: string; dataBase64: string }[] = [];
  for (const a of r.attachments.slice(0, 3)) {
    const data = await privateStorage.read(a.storageKey);
    if (data) attachments.push({ name: a.originalName || "mekan-fotografi.jpg", mimeType: a.mimeType, dataBase64: data.toString("base64") });
  }
  return {
    version: 1 as const,
    submissionId: r.id,
    formType: r.type,
    submittedAt: r.createdAt.toISOString(),
    name: r.name,
    phone: r.phone,
    email: r.email,
    message: r.message,
    district: r.district,
    topic: r.topic,
    projectStage: r.projectStage,
    timeline: r.timeline,
    selection: r.selection,
    productName: r.productName,
    categoryName: r.categoryName,
    sourcePath: r.sourcePath,
    consent: { kvkkAcknowledged: r.kvkkConsent, consentAt: r.consentAt?.toISOString() ?? null, noticeVersion: null },
    attachments,
  };
}

/** Tek talebi CRM'e gönderir. Asla hata fırlatmaz; sonucu döner (kişisel veri loglanmaz). */
export async function forwardRequestToCrm(requestId: string, cfg = crmForwardConfig()): Promise<ForwardResult> {
  if (!cfg) return { ok: false, error: "disabled" };
  try {
    const payload = await buildPayload(requestId);
    if (!payload) return { ok: false, error: "not_found" };
    const { status, json } = await signedPost(cfg, "/api/v1/intake/website", payload, 20_000);
    if (status === 200 || status === 202) return { ok: true, duplicate: Boolean((json as { duplicate?: boolean } | null)?.duplicate) };
    const code = (json as { error?: { code?: string } } | null)?.error?.code ?? "http_error";
    return { ok: false, status, error: code };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.name : "network_error" };
  }
}

/**
 * Form action'ından çağrılır: yanıt ziyaretçiye gittikten sonra aktarır. Bayrak kapalıysa hiçbir şey yapmaz.
 * Başarısızlık yalnız loglanır; kaçan talep cron mutabakatıyla (scripts/crm-forward.ts) yeniden gönderilir.
 */
export function forwardToCrmAfterResponse(requestId: string) {
  const cfg = crmForwardConfig();
  if (!cfg) return;
  try {
    after(async () => {
      const r = await forwardRequestToCrm(requestId, cfg);
      if (!r.ok) console.error(`[crm-forward] ${requestId} aktarılamadı (${r.status ?? "-"} ${r.error}); mutabakat yeniden deneyecek.`);
    });
  } catch {
    // İstek bağlamı dışında çağrıldıysa (olmamalı) sessizce geç; mutabakat yakalar.
  }
}

/** Bağlantı testi: boş kimlik listesiyle imzalı mutabakat isteği. Sır eşleşmiyorsa CRM 401 döner. Kişisel veri gönderilmez. */
export async function checkCrmConnection(): Promise<{ enabled: boolean; ok: boolean; status?: number; error?: string }> {
  const cfg = crmForwardConfig();
  if (!cfg) return { enabled: false, ok: false };
  try {
    const { status, json } = await signedPost(cfg, "/api/v1/intake/website/status", { submissionIds: [] }, 10_000);
    return { enabled: true, ok: status === 200, status, error: (json as { error?: { code?: string } } | null)?.error?.code };
  } catch (e) {
    return { enabled: true, ok: false, error: e instanceof Error ? e.name : "network_error" };
  }
}

/**
 * Mutabakat: son `sinceHours` saatteki talepleri CRM'e sorar, eksik olanları gönderir.
 * Cron ile (ör. 10 dakikada bir) çalıştırılır. dryRun: yalnız sayar, göndermez.
 */
export async function reconcileWithCrm(opts: { sinceHours: number; dryRun?: boolean }) {
  const cfg = crmForwardConfig();
  if (!cfg) return { enabled: false as const };
  const since = new Date(Date.now() - opts.sinceHours * 3600_000);
  const rows = await prisma.contactRequest.findMany({ where: { createdAt: { gte: since } }, select: { id: true }, orderBy: { createdAt: "asc" }, take: 500 });
  const ids = rows.map((r) => r.id);
  if (!ids.length) return { enabled: true as const, checked: 0, missing: 0, sent: 0, failed: 0 };
  const { status, json } = await signedPost(cfg, "/api/v1/intake/website/status", { submissionIds: ids }, 15_000);
  if (status !== 200) throw new Error(`CRM mutabakat yanıtı ${status} ${(json as { error?: { code?: string } } | null)?.error?.code ?? ""}`.trim());
  const received = new Set((json as { received?: string[] }).received ?? []);
  const missing = ids.filter((id) => !received.has(id));
  let sent = 0;
  let failed = 0;
  if (!opts.dryRun) {
    for (const id of missing) {
      const r = await forwardRequestToCrm(id, cfg);
      if (r.ok) sent++;
      else {
        failed++;
        console.error(`[crm-forward] ${id}: ${r.status ?? "-"} ${r.error}`);
      }
    }
  }
  return { enabled: true as const, checked: ids.length, missing: missing.length, sent, failed };
}
