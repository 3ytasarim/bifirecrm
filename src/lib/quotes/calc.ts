import { RuleError } from "@/lib/errors";

/**
 * Teklif tutar hesabı. Kayan nokta KULLANILMAZ: miktar binde birlik, tutarlar kuruş, oranlar yüzde yüzde birlik
 * tam sayılara çevrilir (BigInt), yuvarlama satır bazında "yarım yukarı" yapılır. DB'deki Decimal alanlar ve
 * PDF aynı sonuçtan beslenir → ekranda, PDF'te ve DB'de tutarlar birebir aynıdır.
 *
 *   brüt    = miktar × birim fiyat
 *   net     = brüt × (1 − iskonto%)          (satır toplamı = net, KDV hariç)
 *   KDV     = net × KDV%
 *   genel   = Σ net + Σ KDV
 */
export type ItemInput = { quantity: string; unitPrice: string; discountPct: string; taxPct: string };
export type ItemResult = { gross: string; net: string; tax: string };
export type QuoteTotals = {
  items: ItemResult[];
  subtotal: string;
  discountTotal: string;
  taxTotal: string;
  grandTotal: string;
  /** KDV oranına göre döküm (PDF ve ekran için), oran artan sırada. */
  taxBreakdown: { rate: string; base: string; tax: string }[];
};

/** "1.234,50" / "1234.5" / "1234" → ondalık basamak sayısına göre ölçeklenmiş BigInt. Geçersizse hata. */
export function toScaled(value: string, decimals: number): bigint {
  const v = value.trim().replace(/\s|₺/g, "");
  // Virgül varsa Türkçe biçim (nokta = binlik). Virgülsüz "125.000" tutar alanında (≤2 ondalık) binlik ayracıdır:
  // 3 haneli kesir 2 ondalıklı tutarda zaten geçersiz olurdu. Miktarda (3 ondalık) nokta ondalık kalır (1.250 m).
  const normalized = v.includes(",") ? v.replace(/\./g, "").replace(",", ".") : decimals <= 2 && /^\d{1,3}(\.\d{3})+$/.test(v) ? v.replace(/\./g, "") : v;
  const m = /^(\d+)(?:\.(\d+))?$/.exec(normalized);
  if (!m) throw new RuleError(`Geçersiz sayı: ${value}`);
  const frac = (m[2] ?? "").padEnd(decimals, "0");
  if (frac.length > decimals && /[1-9]/.test(frac.slice(decimals))) throw new RuleError(`En fazla ${decimals} ondalık: ${value}`);
  return BigInt(m[1]) * 10n ** BigInt(decimals) + BigInt(frac.slice(0, decimals) || "0");
}

/** Negatif olmayan a/b, yarım yukarı yuvarlama. */
function roundDiv(a: bigint, b: bigint): bigint {
  return (a * 2n + b) / (2n * b);
}

export function fromScaled(v: bigint, decimals: number): string {
  const neg = v < 0n;
  const abs = neg ? -v : v;
  const base = 10n ** BigInt(decimals);
  const int = abs / base;
  const frac = (abs % base).toString().padStart(decimals, "0");
  return `${neg ? "-" : ""}${int}${decimals ? "." + frac : ""}`;
}

export function calcItem(i: ItemInput) {
  const qty = toScaled(i.quantity, 3); // binde
  const price = toScaled(i.unitPrice, 2); // kuruş
  const disc = toScaled(i.discountPct, 2); // %0,01
  const tax = toScaled(i.taxPct, 2);
  if (disc > 10000n) throw new RuleError("İskonto %100'den büyük olamaz.");
  if (tax > 10000n) throw new RuleError("KDV oranı geçersiz.");
  const gross = roundDiv(qty * price, 1000n);
  const net = roundDiv(gross * (10000n - disc), 10000n);
  const taxAmt = roundDiv(net * tax, 10000n);
  return { gross, net, tax: taxAmt, taxRate: tax };
}

export function calcQuote(items: ItemInput[]): QuoteTotals {
  let subtotal = 0n;
  let netSum = 0n;
  let taxSum = 0n;
  const byRate = new Map<bigint, { base: bigint; tax: bigint }>();
  const results: ItemResult[] = items.map((i) => {
    const r = calcItem(i);
    subtotal += r.gross;
    netSum += r.net;
    taxSum += r.tax;
    const b = byRate.get(r.taxRate) ?? { base: 0n, tax: 0n };
    b.base += r.net;
    b.tax += r.tax;
    byRate.set(r.taxRate, b);
    return { gross: fromScaled(r.gross, 2), net: fromScaled(r.net, 2), tax: fromScaled(r.tax, 2) };
  });
  return {
    items: results,
    subtotal: fromScaled(subtotal, 2),
    discountTotal: fromScaled(subtotal - netSum, 2),
    taxTotal: fromScaled(taxSum, 2),
    grandTotal: fromScaled(netSum + taxSum, 2),
    taxBreakdown: [...byRate.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([rate, v]) => ({ rate: fromScaled(rate, 2), base: fromScaled(v.base, 2), tax: fromScaled(v.tax, 2) })),
  };
}

/** Ekranda/PDF'te tutar: "125.000,50 ₺" (kuruş her zaman gösterilir). */
export function formatAmount(value: string, currency = "TRY") {
  return new Intl.NumberFormat("tr-TR", { style: "currency", currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(value));
}

/** DB değeri → düzenleme alanı: "20.00" → "20", "1.500" → "1,5", "1250.50" → "1250,5". */
export function plainNumber(v: string) {
  return v.replace(/(\.\d*?[1-9])0+$|\.0+$/, "$1").replace(".", ",");
}

/** "20.00" → "%20", "1.50" → "%1,5" */
export function formatPct(value: string) {
  return "%" + Number(value).toLocaleString("tr-TR", { maximumFractionDigits: 2 });
}
