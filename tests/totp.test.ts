import { describe, expect, it } from "vitest";
import { base32Decode, base32Encode, generateTotpSecret, hotp, verifyTotp } from "@/lib/auth/totp";

// RFC 6238 Ek B test vektörleri (SHA-1; 8 hanenin son 6 hanesi)
const RFC_SECRET = base32Encode(Buffer.from("12345678901234567890"));

describe("TOTP", () => {
  it("base32 gidiş-dönüş", () => {
    const s = generateTotpSecret();
    expect(base32Encode(base32Decode(s))).toBe(s);
  });
  it("RFC 6238 vektörleri", () => {
    expect(hotp(RFC_SECRET, Math.floor(59 / 30))).toBe("287082");
    expect(hotp(RFC_SECRET, Math.floor(1111111109 / 30))).toBe("081804");
    expect(hotp(RFC_SECRET, Math.floor(1234567890 / 30))).toBe("005924");
  });
  it("±1 adım tolerans, fazlası reddedilir", () => {
    const now = 1_700_000_000_000;
    const step = Math.floor(now / 30_000);
    expect(verifyTotp(RFC_SECRET, hotp(RFC_SECRET, step), now)).toBe(true);
    expect(verifyTotp(RFC_SECRET, hotp(RFC_SECRET, step - 1), now)).toBe(true);
    expect(verifyTotp(RFC_SECRET, hotp(RFC_SECRET, step + 3), now)).toBe(false);
    expect(verifyTotp(RFC_SECRET, "abc123", now)).toBe(false);
  });
});
