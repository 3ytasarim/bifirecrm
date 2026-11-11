import { describe, expect, it } from "vitest";
import { calcItem, calcQuote, fromScaled, toScaled } from "@/lib/quotes/calc";

describe("sayı ayrıştırma", () => {
  it("Türkçe ve nokta biçimleri", () => {
    expect(toScaled("1.234,50", 2)).toBe(123450n);
    expect(toScaled("1234.5", 2)).toBe(123450n);
    expect(toScaled("1234", 2)).toBe(123400n);
    expect(toScaled("2,5", 3)).toBe(2500n);
    expect(toScaled("125.000", 2)).toBe(12500000n);
  });
  it("geçersiz ve fazla ondalık reddedilir", () => {
    expect(() => toScaled("abc", 2)).toThrow();
    expect(() => toScaled("-5", 2)).toThrow();
    expect(() => toScaled("1.2399", 2)).toThrow();
    expect(toScaled("1.230", 2)).toBe(123000n); // tutarda binlik
    expect(toScaled("1.250", 3)).toBe(1250n); // miktarda ondalık (1,25)
  });
  it("geri biçimleme", () => {
    expect(fromScaled(123450n, 2)).toBe("1234.50");
    expect(fromScaled(5n, 2)).toBe("0.05");
  });
});

describe("teklif hesabı", () => {
  it("tek satır: iskonto + KDV", () => {
    const r = calcItem({ quantity: "2", unitPrice: "1000", discountPct: "10", taxPct: "20" });
    expect(fromScaled(r.gross, 2)).toBe("2000.00");
    expect(fromScaled(r.net, 2)).toBe("1800.00");
    expect(fromScaled(r.tax, 2)).toBe("360.00");
  });
  it("yarım kuruş yukarı yuvarlanır (satır bazında)", () => {
    // 1 × 0,05 × %50 = 0,025 → 0,03
    const r = calcItem({ quantity: "1", unitPrice: "0.05", discountPct: "50", taxPct: "0" });
    expect(fromScaled(r.net, 2)).toBe("0.03");
    // 3 × 33,33 = 99,99; KDV %20 = 19,998 → 20,00
    const r2 = calcItem({ quantity: "3", unitPrice: "33.33", discountPct: "0", taxPct: "20" });
    expect(fromScaled(r2.tax, 2)).toBe("20.00");
  });
  it("kesirli miktar (metre)", () => {
    const r = calcItem({ quantity: "2,75", unitPrice: "1.250,00", discountPct: "0", taxPct: "20" });
    expect(fromScaled(r.net, 2)).toBe("3437.50");
  });
  it("toplamlar ve KDV dökümü tutarlı", () => {
    const t = calcQuote([
      { quantity: "1", unitPrice: "85000", discountPct: "5", taxPct: "20" },
      { quantity: "1", unitPrice: "12500", discountPct: "0", taxPct: "20" },
      { quantity: "3", unitPrice: "450", discountPct: "0", taxPct: "10" },
    ]);
    expect(t.subtotal).toBe("98850.00");
    expect(t.discountTotal).toBe("4250.00");
    // net: 80750 + 12500 + 1350 = 94600; KDV: 16150 + 2500 + 135 = 18785
    expect(t.taxTotal).toBe("18785.00");
    expect(t.grandTotal).toBe("113385.00");
    expect(t.taxBreakdown).toEqual([
      { rate: "10.00", base: "1350.00", tax: "135.00" },
      { rate: "20.00", base: "93250.00", tax: "18650.00" },
    ]);
    // Σ satır net + Σ KDV = genel toplam
    const sumNet = t.items.reduce((s, i) => s + Number(i.net), 0);
    expect((sumNet + Number(t.taxTotal)).toFixed(2)).toBe(t.grandTotal);
  });
  it("büyük tutarda hassasiyet kaybı yok", () => {
    const t = calcQuote([{ quantity: "999.999", unitPrice: "9999999.99", discountPct: "0", taxPct: "20" }]);
    expect(t.subtotal).toBe("9999989990.00");
  });
  it("iskonto %100'ü aşamaz", () => {
    expect(() => calcItem({ quantity: "1", unitPrice: "10", discountPct: "101", taxPct: "20" })).toThrow();
  });
});

describe("zMoney (fırsat tutarı alanı)", async () => {
  const { zMoney } = await import("@/lib/action");
  it("binlik ve ondalık biçimleri doğru okur", () => {
    expect(zMoney.parse("125.000")).toBe("125000.00");
    expect(zMoney.parse("125.000,50")).toBe("125000.50");
    expect(zMoney.parse("1234.50")).toBe("1234.50");
    expect(zMoney.parse("")).toBeNull();
    expect(zMoney.safeParse("12a").success).toBe(false);
  });
});
