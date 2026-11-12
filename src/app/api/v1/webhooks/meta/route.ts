import { NextResponse, type NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { safeEqual } from "@/lib/crypto";
import { rateLimit } from "@/lib/rate-limit";
import { enqueue } from "@/lib/jobs/queue";
import { apiError, clientIpHash } from "@/lib/integrations/website-request";
import { metaWebhookSecrets } from "@/lib/integrations/channels-config";
import { verifyMetaSignature } from "@/lib/integrations/meta-signature";
import { parseMetaWebhook } from "@/lib/integrations/meta-webhook";
import { markEventReceived } from "@/lib/integrations/health";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 1024 * 1024;

/**
 * GET /api/v1/webhooks/meta — Meta abonelik doğrulaması (hub.verify_token eşleşirse hub.challenge döner).
 */
export async function GET(req: NextRequest) {
  const secrets = metaWebhookSecrets();
  if (!secrets) return apiError(503, "not_configured", "Meta entegrasyonu yapılandırılmadı.");
  const q = req.nextUrl.searchParams;
  const challenge = q.get("hub.challenge") ?? "";
  const token = q.get("hub.verify_token") ?? "";
  if (q.get("hub.mode") !== "subscribe" || !safeEqual(token, secrets.verifyToken) || !/^[A-Za-z0-9_-]{1,200}$/.test(challenge)) {
    await rateLimit(`meta-webhook-fail:${clientIpHash(req)}`, 30, 600);
    return apiError(403, "verification_failed", "Doğrulama başarısız.");
  }
  return new NextResponse(challenge, { status: 200, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
}

/**
 * POST /api/v1/webhooks/meta — Lead Ads, Instagram mesajları, WhatsApp mesaj/durum bildirimleri.
 * İmza (X-Hub-Signature-256, uygulama sırrı) doğrulanmadan gövde işlenmez. Her olay tekil anahtarla
 * integration_events'e yazılır + iş kuyruğuna alınır; Meta aynı bildirimi tekrar gönderirse ikinci kayıt oluşmaz.
 * Ağır iş (Graph API'den form verisi çekme, müşteri eşleştirme) worker'da yapılır; yanıt hızlı döner.
 */
export async function POST(req: NextRequest) {
  const secrets = metaWebhookSecrets();
  if (!secrets) return apiError(503, "not_configured", "Meta entegrasyonu yapılandırılmadı.");

  const ipKey = `meta-webhook-fail:${clientIpHash(req)}`;
  const blocked = await prisma.rateLimitBucket.findUnique({ where: { key: ipKey } });
  if (blocked && blocked.count > 30 && blocked.resetAt > new Date()) return apiError(429, "rate_limited", "Çok fazla hatalı istek.");
  const fail = async (status: number, code: string, message: string) => {
    await rateLimit(ipKey, 30, 600);
    return apiError(status, code, message);
  };

  if (Number(req.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) return fail(413, "payload_too_large", "İstek gövdesi çok büyük.");
  const rawBody = await req.text();
  if (Buffer.byteLength(rawBody) > MAX_BODY_BYTES) return fail(413, "payload_too_large", "İstek gövdesi çok büyük.");
  if (!verifyMetaSignature(secrets.appSecret, rawBody, req.headers.get("x-hub-signature-256"))) return fail(401, "invalid_signature", "İmza doğrulanamadı.");

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return apiError(400, "invalid_json", "Gövde geçerli JSON değil.");
  }

  const events = parseMetaWebhook(body, { whatsappPhoneNumberId: env().WHATSAPP_PHONE_NUMBER_ID ?? null });
  let accepted = 0;
  let duplicates = 0;
  const providers = new Set<(typeof events)[number]["provider"]>();
  for (const e of events) {
    try {
      await prisma.$transaction(async (t) => {
        const ev = await t.integrationEvent.create({
          data: { provider: e.provider, externalEventId: e.externalEventId, eventType: e.eventType, status: "PENDING", payload: e.payload as Prisma.InputJsonValue },
        });
        await enqueue(e.jobType, { eventId: ev.id }, { eventId: ev.id }, t);
      });
      accepted++;
      providers.add(e.provider);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        duplicates++;
        continue;
      }
      // Meta 200 dışı yanıtta bildirimi yeniden gönderir; kaydedilemeyen olay kaybolmaz.
      console.error("[webhooks/meta] kayıt hatası:", err instanceof Error ? err.message : "bilinmeyen");
      return apiError(500, "internal_error", "Olay kaydedilemedi.");
    }
  }
  for (const p of providers) await markEventReceived(p).catch(() => {});
  return NextResponse.json({ ok: true, accepted, duplicates }, { headers: { "Cache-Control": "no-store" } });
}
