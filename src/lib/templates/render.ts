/**
 * Mesaj şablonu değişkenleri. Gövde yalnız bu listedeki {{değişken}}leri kullanabilir; bilinmeyen değişken kayıtta reddedilir
 * (yazım hatası müşteriye "{{adi}}" olarak gitmesin). Değerler düz metin olarak yerleştirilir — HTML/biçim yorumlanmaz.
 */
export const TEMPLATE_VARIABLES = {
  ad: "Müşterinin adı",
  soyad: "Müşterinin soyadı",
  adsoyad: "Müşterinin tam adı",
  firsat: "Fırsat başlığı",
  urun: "Ürün / model",
  teklif_no: "Son teklif numarası",
  teklif_tutar: "Son teklif genel toplamı",
  teklif_gecerlilik: "Son teklif geçerlilik tarihi",
  randevu_tarih: "Sıradaki randevu tarihi/saati",
  randevu_yer: "Sıradaki randevu yeri",
  temsilci: "Sorumlu temsilcinin adı",
  temsilci_tel: "Sorumlu temsilcinin telefonu",
  firma: "Firma adı (teklif antetinin ilk satırı)",
} as const;

export type TemplateVariable = keyof typeof TEMPLATE_VARIABLES;
export type TemplateContext = Partial<Record<TemplateVariable, string | null>>;

const VAR_RE = /\{\{\s*([a-zA-Z_ğüşıöçĞÜŞİÖÇ]+)\s*\}\}/g;

/** Gövdedeki değişkenler (tekrarsız, ilk görülme sırasıyla). */
export function extractVariables(body: string): string[] {
  return [...new Set([...body.matchAll(VAR_RE)].map((m) => m[1]))];
}

export function unknownVariables(body: string): string[] {
  return extractVariables(body).filter((v) => !(v in TEMPLATE_VARIABLES));
}

/** Değişkenleri yerleştirir; değeri olmayanlar listede döner (önizlemede uyarı için) ve "[ad]" gibi işaretlenir. */
export function renderTemplate(body: string, ctx: TemplateContext): { text: string; missing: string[] } {
  const missing = new Set<string>();
  const text = body.replace(VAR_RE, (_, name: string) => {
    const v = ctx[name as TemplateVariable];
    if (v === null || v === undefined || v === "") {
      missing.add(name);
      return `[${name}]`;
    }
    return v;
  });
  return { text, missing: [...missing] };
}
