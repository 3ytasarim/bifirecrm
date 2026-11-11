import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Site → CRM istek imzası (sürüm v1). Aynı algoritma sitede `src/lib/crm/forward.ts` içinde uygulanır.
 *
 *   X-Bifire-Timestamp: unix saniye
 *   X-Bifire-Nonce:     16–64 karakter [A-Za-z0-9_-], her istekte yeni
 *   X-Bifire-Signature: "v1=" + hex(HMAC-SHA256(secret, `${timestamp}.${nonce}.${rawBody}`))
 *
 * Gövde ham haliyle imzalanır (JSON yeniden serileştirilmez). Zaman penceresi ±5 dk; nonce tekrarı ayrıca DB'de reddedilir.
 */
export const SIGNATURE_WINDOW_SEC = 300;
const NONCE_RE = /^[A-Za-z0-9_-]{16,64}$/;

export function computeSignature(secret: string, timestamp: string, nonce: string, rawBody: string): string {
  return "v1=" + createHmac("sha256", secret).update(`${timestamp}.${nonce}.${rawBody}`).digest("hex");
}

export type SignatureCheck = { ok: true; timestamp: number; nonce: string } | { ok: false; code: "missing_headers" | "invalid_nonce" | "stale_timestamp" | "invalid_signature" };

export function verifySignature(input: { secret: string; timestamp: string | null; nonce: string | null; signature: string | null; rawBody: string; nowSec?: number }): SignatureCheck {
  const { secret, timestamp, nonce, signature, rawBody } = input;
  if (!timestamp || !nonce || !signature) return { ok: false, code: "missing_headers" };
  if (!NONCE_RE.test(nonce)) return { ok: false, code: "invalid_nonce" };
  if (!/^\d{9,11}$/.test(timestamp)) return { ok: false, code: "stale_timestamp" };
  const ts = Number(timestamp);
  const now = input.nowSec ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - ts) > SIGNATURE_WINDOW_SEC) return { ok: false, code: "stale_timestamp" };
  const expected = Buffer.from(computeSignature(secret, timestamp, nonce, rawBody));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return { ok: false, code: "invalid_signature" };
  return { ok: true, timestamp: ts, nonce };
}
