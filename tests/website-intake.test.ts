import { describe, expect, it } from "vitest";
import { computeSignature, verifySignature } from "@/lib/integrations/signature";
import { websitePayloadSchema } from "@/lib/integrations/website-payload";

const secret = "x".repeat(40);
const body = JSON.stringify({ hello: "dünya" });
const ts = "1762862400";
const nonce = "abcdefghijklmnop1234";

describe("site → CRM imzası", () => {
  it("doğru imzayı kabul eder", () => {
    const sig = computeSignature(secret, ts, nonce, body);
    expect(sig).toMatch(/^v1=[0-9a-f]{64}$/);
    expect(verifySignature({ secret, timestamp: ts, nonce, signature: sig, rawBody: body, nowSec: Number(ts) + 10 })).toEqual({ ok: true, timestamp: Number(ts), nonce });
  });
  it("gövde değişirse reddeder", () => {
    const sig = computeSignature(secret, ts, nonce, body);
    expect(verifySignature({ secret, timestamp: ts, nonce, signature: sig, rawBody: body + " ", nowSec: Number(ts) })).toMatchObject({ ok: false, code: "invalid_signature" });
  });
  it("yanlış sırla imzalanmışsa reddeder", () => {
    const sig = computeSignature("y".repeat(40), ts, nonce, body);
    expect(verifySignature({ secret, timestamp: ts, nonce, signature: sig, rawBody: body, nowSec: Number(ts) })).toMatchObject({ ok: false, code: "invalid_signature" });
  });
  it("5 dakikadan eski/ileri zamanı reddeder", () => {
    const sig = computeSignature(secret, ts, nonce, body);
    expect(verifySignature({ secret, timestamp: ts, nonce, signature: sig, rawBody: body, nowSec: Number(ts) + 301 })).toMatchObject({ ok: false, code: "stale_timestamp" });
    expect(verifySignature({ secret, timestamp: ts, nonce, signature: sig, rawBody: body, nowSec: Number(ts) - 301 })).toMatchObject({ ok: false, code: "stale_timestamp" });
  });
  it("eksik başlık ve geçersiz nonce", () => {
    expect(verifySignature({ secret, timestamp: null, nonce, signature: "v1=00", rawBody: body })).toMatchObject({ ok: false, code: "missing_headers" });
    expect(verifySignature({ secret, timestamp: ts, nonce: "kisa", signature: "v1=00", rawBody: body })).toMatchObject({ ok: false, code: "invalid_nonce" });
    expect(verifySignature({ secret, timestamp: ts, nonce: "a b c d e f g h i j", signature: "v1=00", rawBody: body })).toMatchObject({ ok: false, code: "invalid_nonce" });
  });
  it("nonce imzaya dahildir (başka nonce ile tekrar oynatılamaz)", () => {
    const sig = computeSignature(secret, ts, nonce, body);
    expect(verifySignature({ secret, timestamp: ts, nonce: nonce + "x", signature: sig, rawBody: body, nowSec: Number(ts) })).toMatchObject({ ok: false, code: "invalid_signature" });
  });
});

describe("web formu yükü", () => {
  const base = {
    version: 1,
    submissionId: "cmabc123def456",
    formType: "QUOTE",
    submittedAt: "2026-11-11T10:00:00.000Z",
    name: "  Ayşe Yılmaz ",
    phone: "0532 111 22 33",
    email: "",
    consent: { kvkkAcknowledged: true, consentAt: "2026-11-11T10:00:00.000Z" },
  };
  it("boş alanları null yapar, ekleri varsayılan boş dizi", () => {
    const r = websitePayloadSchema.parse(base);
    expect(r.name).toBe("Ayşe Yılmaz");
    expect(r.email).toBeNull();
    expect(r.message).toBeNull();
    expect(r.attachments).toEqual([]);
  });
  it("bilinmeyen form türünü ve bozuk kimliği reddeder", () => {
    expect(websitePayloadSchema.safeParse({ ...base, formType: "SPAM" }).success).toBe(false);
    expect(websitePayloadSchema.safeParse({ ...base, submissionId: "../../etc" }).success).toBe(false);
    expect(websitePayloadSchema.safeParse({ ...base, version: 2 }).success).toBe(false);
  });
  it("en fazla 3 ek", () => {
    const a = { name: "a.jpg", mimeType: "image/jpeg", dataBase64: "AAAA" };
    expect(websitePayloadSchema.safeParse({ ...base, attachments: [a, a, a, a] }).success).toBe(false);
  });
});
