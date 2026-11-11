import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { sha256 } from "@/lib/crypto";
import { rateLimit } from "@/lib/rate-limit";
import { SIGNATURE_WINDOW_SEC, verifySignature } from "./signature";

/** Tüm JSON uç noktaları için tek hata biçimi. */
export function apiError(status: number, code: string, message: string) {
  return NextResponse.json({ error: { code, message } }, { status, headers: { "Cache-Control": "no-store" } });
}

export function clientIpHash(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown";
  return sha256(`ip:${ip}`).slice(0, 32);
}

/**
 * Site isteğini doğrular: yapılandırma → boyut → imza + zaman penceresi → nonce tekrarı.
 * Başarısız denemeler IP özeti başına sınırlanır (kaba kuvvet / gürültü). Gövde yalnız doğrulamadan sonra işlenir.
 */
export async function readSignedWebsiteRequest(req: NextRequest, maxBytes: number): Promise<{ ok: true; rawBody: string } | { ok: false; response: NextResponse }> {
  const secret = env().WEBSITE_HMAC_SECRET;
  if (!secret || secret.length < 32) return { ok: false, response: apiError(503, "not_configured", "Web sitesi entegrasyonu yapılandırılmadı.") };

  const ipKey = `website-intake-fail:${clientIpHash(req)}`;
  const fail = async (status: number, code: string, message: string) => {
    await rateLimit(ipKey, 30, 600);
    return { ok: false as const, response: apiError(status, code, message) };
  };
  // Sınır aşılmışsa imzayı hiç hesaplama.
  const blocked = await prisma.rateLimitBucket.findUnique({ where: { key: ipKey } });
  if (blocked && blocked.count > 30 && blocked.resetAt > new Date()) return { ok: false, response: apiError(429, "rate_limited", "Çok fazla hatalı istek.") };

  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > maxBytes) return fail(413, "payload_too_large", "İstek gövdesi çok büyük.");
  const rawBody = await req.text();
  if (Buffer.byteLength(rawBody) > maxBytes) return fail(413, "payload_too_large", "İstek gövdesi çok büyük.");

  const check = verifySignature({
    secret,
    timestamp: req.headers.get("x-bifire-timestamp"),
    nonce: req.headers.get("x-bifire-nonce"),
    signature: req.headers.get("x-bifire-signature"),
    rawBody,
  });
  if (!check.ok) return fail(401, check.code, "İmza doğrulanamadı.");

  try {
    await prisma.webhookNonce.create({ data: { nonce: check.nonce, provider: "BIFIRE_WEBSITE", expiresAt: new Date((check.timestamp + SIGNATURE_WINDOW_SEC * 2) * 1000) } });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return fail(409, "replayed_request", "Bu istek daha önce alındı.");
    throw e;
  }
  return { ok: true, rawBody };
}
