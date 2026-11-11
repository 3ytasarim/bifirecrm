import { describe, expect, it } from "vitest";
import { extractVariables, renderTemplate, unknownVariables } from "@/lib/templates/render";

describe("mesaj şablonu", () => {
  it("değişkenleri yerleştirir, boşlukları tolere eder", () => {
    expect(renderTemplate("Merhaba {{ad}}, teklifiniz {{ teklif_no }} hazır.", { ad: "Ayşe", teklif_no: "T-000012" }).text).toBe("Merhaba Ayşe, teklifiniz T-000012 hazır.");
  });
  it("eksik değeri işaretler ve listeler", () => {
    const r = renderTemplate("{{ad}} {{randevu_tarih}}", { ad: "Ali" });
    expect(r.text).toBe("Ali [randevu_tarih]");
    expect(r.missing).toEqual(["randevu_tarih"]);
  });
  it("bilinmeyen değişkeni yakalar", () => {
    expect(unknownVariables("{{ad}} {{adi}} {{urun}}")).toEqual(["adi"]);
    expect(extractVariables("{{ad}} {{ad}} {{urun}}")).toEqual(["ad", "urun"]);
  });
  it("değerdeki süslü parantezleri yeniden işlemez", () => {
    expect(renderTemplate("{{ad}}", { ad: "{{soyad}}" }).text).toBe("{{soyad}}");
  });
});
