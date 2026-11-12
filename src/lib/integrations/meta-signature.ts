import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Meta webhook imzası: X-Hub-Signature-256 = "sha256=" + hex(HMAC-SHA256(app secret, ham gövde)).
 * Gövde ham haliyle doğrulanır (JSON yeniden serileştirilmez). Zaman damgası yoktur; tekrar koruması olay kimliğiyle (idempotency) sağlanır.
 */
export function metaSignature(appSecret: string, rawBody: string): string {
  return "sha256=" + createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex");
}

export function verifyMetaSignature(appSecret: string, rawBody: string, header: string | null): boolean {
  if (!header || !/^sha256=[0-9a-f]{64}$/.test(header)) return false;
  const expected = Buffer.from(metaSignature(appSecret, rawBody));
  const given = Buffer.from(header);
  return expected.length === given.length && timingSafeEqual(expected, given);
}
