import { parsePhoneNumberFromString } from "libphonenumber-js/max";

/**
 * Telefonu E.164'e çevirir. Ülke kodu yoksa Türkiye varsayılır ("0532 123 45 67" → "+905321234567").
 * Geçersiz numarada null döner (ham değer ayrıca saklanır, sessizce bozulmaz).
 */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const cleaned = raw.trim();
  if (!cleaned) return null;
  const p = parsePhoneNumberFromString(cleaned, "TR");
  if (!p || !p.isValid()) return null;
  return p.number;
}

export function formatPhone(e164: string | null | undefined): string {
  if (!e164) return "";
  const p = parsePhoneNumberFromString(e164);
  if (!p) return e164;
  return p.country === "TR" ? p.formatNational() : p.formatInternational();
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Küçük harf + boşluk temizliği. Gmail nokta/artı kuralları gibi sağlayıcıya özel dönüşüm YAPILMAZ (yanlış eşleşme riski). */
export function normalizeEmail(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const e = raw.trim().toLocaleLowerCase("en-US");
  return EMAIL_RE.test(e) ? e : null;
}

export function splitName(full: string): { firstName: string; lastName: string | null } {
  const parts = full.trim().replace(/\s+/g, " ").split(" ");
  if (parts.length === 1) return { firstName: parts[0], lastName: null };
  return { firstName: parts.slice(0, -1).join(" "), lastName: parts[parts.length - 1] };
}

export function fullNameOf(firstName: string, lastName?: string | null) {
  return [firstName.trim(), lastName?.trim()].filter(Boolean).join(" ");
}

/** Etiket anahtarı: "İ"→"i", gerisi dil bağımsız küçük harf ("VIP" → "vip", tr-TR kuralıyla "vıp" olmasın). */
export function tagKey(raw: string): string {
  return raw.trim().replace(/İ/g, "i").toLowerCase();
}

export function parseTags(raw: string | null | undefined): string[] {
  if (!raw) return [];
  return Array.from(
    new Set(
      raw
        .split(",")
        .map(tagKey)
        .filter((t) => t.length > 0 && t.length <= 40),
    ),
  ).slice(0, 20);
}
