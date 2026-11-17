import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { safeEqual } from "@/lib/crypto";
import { rateLimit } from "@/lib/rate-limit";
import { apiError, clientIpHash } from "@/lib/integrations/website-request";
import { whatsappConfig } from "@/lib/integrations/channels-config";
import { parseD360Event, parseMetaWebhook } from "@/lib/integrations/meta-webhook";
import { storeChannelEvents } from "@/lib/integrations/store-events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Geçmiş aktarımı tek seferde büyük gelebilir.
const MAX_BODY_BYTES = 8 * 1024 * 1024;

/**
 * POST /api/v1/webhooks/whatsapp-360dialog — WhatsApp (360dialog, coexistence).
 *
 * 360dialog webhook'ları imzalamaz; bunun yerine webhook kaydında verdiğimiz özel başlık her istekte döner:
 *   X-Bifire-Webhook-Token: <D360_WEBHOOK_SECRET>   (scripts/d360-webhook.ts kaydeder)
 * Başlık sabit zamanlı karşılaştırılır; yanlışsa gövde işlenmez. Adres yalnız https (360dialog şartı).
 *
 * Gövde iki biçimde gelir:
 *  - Meta zarfı (object: whatsapp_business_account): gelen mesajlar, durumlar, smb_message_echoes (telefondan yazılan yanıtlar).
 *  - { event: "history" | "smb_app_state_sync", data }: bağlantı anında eski yazışmalar / rehber eşitlemesi.
 * 360dialog 5 sn içinde 200 bekler → ağır iş worker'da.
 */
export async function POST(req: NextRequest) {
  const cfg = whatsappConfig();
  if (!cfg || cfg.provider !== "360dialog") return apiError(503, "not_configured", "WhatsApp (360dialog) yapılandırılmadı.");

  const ipKey = `d360-webhook-fail:${clientIpHash(req)}`;
  const blocked = await prisma.rateLimitBucket.findUnique({ where: { key: ipKey } });
  if (blocked && blocked.count > 30 && blocked.resetAt > new Date()) return apiError(429, "rate_limited", "Çok fazla hatalı istek.");
  const fail = async (status: number, code: string, message: string) => {
    await rateLimit(ipKey, 30, 600);
    return apiError(status, code, message);
  };

  if (!safeEqual(req.headers.get("x-bifire-webhook-token") ?? "", cfg.webhookSecret)) return fail(401, "invalid_token", "Yetkisiz.");
  if (Number(req.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) return fail(413, "payload_too_large", "İstek gövdesi çok büyük.");
  const rawBody = await req.text();
  if (Buffer.byteLength(rawBody) > MAX_BODY_BYTES) return fail(413, "payload_too_large", "İstek gövdesi çok büyük.");

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return apiError(400, "invalid_json", "Gövde geçerli JSON değil.");
  }

  const opts = { whatsappPhoneNumberId: cfg.phoneNumberId };
  const d360 = parseD360Event(body, opts);
  // Bu uçtan yalnız WhatsApp olayları kabul edilir.
  const events = (d360.kind === "other" ? parseMetaWebhook(body, opts) : d360.events).filter((e) => e.provider === "WHATSAPP");
  if (d360.declined) console.warn("[webhooks/whatsapp-360dialog] işletme geçmiş yazışma aktarımını reddetti");
  const r = await storeChannelEvents(events, "webhooks/whatsapp-360dialog");
  if (!r.ok) return apiError(500, "internal_error", "Olay kaydedilemedi.");
  return NextResponse.json({ ok: true, accepted: r.accepted, duplicates: r.duplicates }, { headers: { "Cache-Control": "no-store" } });
}
