import { describe, expect, it } from "vitest";
import { normalizeEmail, normalizePhone, parseTags, splitName, fullNameOf } from "@/lib/normalize";

describe("normalizePhone", () => {
  it("TR yerel biçimleri E.164'e çevirir", () => {
    expect(normalizePhone("0532 123 45 67")).toBe("+905321234567");
    expect(normalizePhone("532-123-4567")).toBe("+905321234567");
    expect(normalizePhone("+90 (532) 123 45 67")).toBe("+905321234567");
  });
  it("yabancı numarayı korur", () => {
    expect(normalizePhone("+49 30 901820")).toBe("+4930901820");
  });
  it("geçersizde null döner", () => {
    expect(normalizePhone("123")).toBeNull();
    expect(normalizePhone("")).toBeNull();
    expect(normalizePhone(null)).toBeNull();
  });
});

describe("normalizeEmail", () => {
  it("küçük harf + trim", () => expect(normalizeEmail("  Ayse@Ornek.COM ")).toBe("ayse@ornek.com"));
  it("Gmail nokta kuralı uygulanmaz", () => expect(normalizeEmail("a.b@gmail.com")).toBe("a.b@gmail.com"));
  it("geçersiz e-posta null", () => {
    expect(normalizeEmail("ayse@")).toBeNull();
    expect(normalizeEmail("ayse ornek.com")).toBeNull();
  });
});

describe("isim ve etiket", () => {
  it("son kelimeyi soyad sayar", () => expect(splitName("  Ayşe  Nur   Yılmaz ")).toEqual({ firstName: "Ayşe Nur", lastName: "Yılmaz" }));
  it("tek kelime", () => expect(splitName("Ayşe")).toEqual({ firstName: "Ayşe", lastName: null }));
  it("fullNameOf", () => expect(fullNameOf(" Ayşe ", null)).toBe("Ayşe"));
  it("etiketleri tekilleştirir, Türkçe küçük harf", () => expect(parseTags("VIP, İstanbul ,vip,, ")).toEqual(["vip", "istanbul"]));
});
