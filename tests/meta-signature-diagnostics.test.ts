import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { describeSignatureFailure } = await import("@/lib/integrations/meta-signature-diagnostics");
const { metaSignature, verifyMetaSignature } = await import("@/lib/integrations/meta-signature");

const SECRET = "0123456789abcdef0123456789abcdef";
const OTHER = "fedcba9876543210fedcba9876543210";
const IG = "17840000000000001";
const body = JSON.stringify({ object: "instagram", entry: [{ id: IG, time: 1, messaging: [{ sender: { id: "999888777" }, message: { mid: "m1", text: "Gizli müşteri mesajı 0532" } }] }] })
  // Meta gövdeyi ASCII + \uXXXX kaçışlı gönderir.
  .replace(/[^\x00-\x7f]/g, (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"));

function dir(files: Record<string, string>) {
  const d = mkdtempSync(join(tmpdir(), "metadiag-"));
  for (const [f, c] of Object.entries(files)) writeFileSync(join(d, f), c);
  return d;
}

describe("Meta imza tanılaması", () => {
  it("sır, imza, mesaj içeriği ve kimlikler çıktıda yer almaz", () => {
    const sig = metaSignature(OTHER, body);
    const out = JSON.stringify(describeSignatureFailure({ rawBody: body, headers: new Headers({ "x-hub-signature-256": sig, "content-length": String(Buffer.byteLength(body)) }), secret: SECRET, runtimeSecret: SECRET, instagramAccountId: IG, cwd: dir({ ".env": `META_APP_SECRET=${SECRET}\n` }) }));
    for (const s of [SECRET, OTHER, sig, sig.slice(7), "Gizli", "0532", "999888777", IG]) expect(out).not.toContain(s);
  });

  it("başlık, gövde, sır biçimi ve kaynağı raporlanır", () => {
    const d = describeSignatureFailure({ rawBody: body, headers: new Headers({ "x-hub-signature-256": metaSignature(OTHER, body), "content-length": String(Buffer.byteLength(body)) }), secret: SECRET, runtimeSecret: SECRET, instagramAccountId: IG, cwd: dir({ ".env": `META_APP_SECRET=${SECRET}\n`, ".env.local": `META_APP_SECRET=${OTHER}\n` }) });
    expect(d.header).toMatchObject({ present: true, prefix: "sha256=", formatOk: true });
    expect(d.body).toMatchObject({ bytes: Buffer.byteLength(body), contentLengthMatches: true, hasNonAscii: false, json: true, object: "instagram", fields: ["messaging[]"], entryCount: 1, entryIsConfiguredInstagramAccount: true });
    expect(d.secret).toEqual({ length: 32, looksLikeMetaAppSecret: true, hasOuterWhitespace: false, hasQuotes: false });
    expect(d.secretSources.find((x) => x.file === ".env")).toMatchObject({ defines: true, matchesRuntime: true });
    expect(d.secretSources.find((x) => x.file === ".env.local")).toMatchObject({ defines: true, matchesRuntime: false });
    expect(d.runtimeValueFromEnvFile).toBe(true);
  });

  it("başlık yok / sha1 / boşluklu sır / süreçten gelen değer ayırt edilir", () => {
    const none = describeSignatureFailure({ rawBody: body, headers: new Headers(), secret: ` ${SECRET}`, runtimeSecret: ` ${SECRET}`, cwd: dir({}) });
    expect(none.header).toMatchObject({ present: false, prefix: null, formatOk: false });
    expect(none.secret.hasOuterWhitespace).toBe(true);
    expect(none.runtimeValueFromEnvFile).toBe(false);
    const sha1 = describeSignatureFailure({ rawBody: "not json", headers: new Headers({ "x-hub-signature-256": "sha1=abc" }), secret: SECRET, runtimeSecret: SECRET, cwd: dir({}) });
    expect(sha1.header.prefix).toBe("sha1=");
    expect(sha1.body).toMatchObject({ json: false });
  });

  it("doğrulama davranışı değişmedi", () => {
    expect(verifyMetaSignature(SECRET, body, metaSignature(SECRET, body))).toBe(true);
    expect(verifyMetaSignature(SECRET, body, metaSignature(OTHER, body))).toBe(false);
  });
});
