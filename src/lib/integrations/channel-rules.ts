/**
 * Kanal kuralları — saf fonksiyonlar (ağ/DB yok), birim testli (tests/meta-channels.test.ts).
 */

// ───────────── Meta Lead Ads alan eşlemesi ─────────────

export type LeadField = { name?: string; values?: unknown[] };

/** Reklam formu alanlarını CRM alanlarına çevirir (Meta'nın standart alan adları + serbest sorular). */
export function mapLeadFields(fields: LeadField[]) {
  const map = new Map<string, string>();
  for (const f of fields) {
    const v = (f.values ?? [])
      .map((x) => (typeof x === "string" || typeof x === "number" ? String(x) : ""))
      .filter(Boolean)
      .join(", ")
      .trim();
    if (f.name && v) map.set(f.name.toLowerCase(), v.slice(0, 1000));
  }
  const take = (...keys: string[]) => {
    for (const k of keys) {
      const v = map.get(k);
      if (v) {
        map.delete(k);
        return v;
      }
    }
    return null;
  };
  const first = take("first_name");
  const last = take("last_name");
  const name = take("full_name", "name") ?? ([first, last].filter(Boolean).join(" ") || null);
  const phone = take("phone_number", "phone");
  const email = take("email");
  const city = take("city");
  const district = take("district", "ilce", "ilçe", "state");
  const extra = [...map.entries()].map(([k, v]) => `${k.replace(/_/g, " ")}: ${v}`);
  return { name, phone, email, city, district, extra };
}

// ───────────── WhatsApp şablonları ─────────────

export type GraphTemplate = {
  id: string;
  name: string;
  language: string;
  status: string;
  category: string;
  components?: { type: string; format?: string; text?: string; buttons?: { type: string; url?: string }[] }[];
};

const varsIn = (s: string | undefined) => new Set([...(s ?? "").matchAll(/\{\{\s*(\d+)\s*\}\}/g)].map((m) => m[1])).size;

/**
 * Şablonun CRM'den gönderilebilir kısmı: yalnız gövde değişkenleri desteklenir. Başlıkta medya/değişken ya da
 * değişkenli/kodlu buton varsa paramCount = -1 (listelenir ama gönderilemez — eksik parametreyle Meta'ya istek atılmaz).
 */
export function templateShape(t: GraphTemplate) {
  const comps = t.components ?? [];
  const body = comps.find((c) => c.type === "BODY")?.text ?? "";
  const header = comps.find((c) => c.type === "HEADER");
  const buttons = comps.find((c) => c.type === "BUTTONS")?.buttons ?? [];
  const unsupported =
    Boolean(header && (header.format !== "TEXT" || varsIn(header.text) > 0)) ||
    buttons.some((b) => b.type === "URL" && /\{\{/.test(b.url ?? "")) ||
    buttons.some((b) => b.type === "COPY_CODE" || b.type === "OTP");
  return { body: [header?.format === "TEXT" ? header.text : null, body].filter(Boolean).join("\n\n"), paramCount: unsupported ? -1 : varsIn(body) };
}

export function renderTemplateBody(body: string, params: string[]) {
  return body.replace(/\{\{\s*(\d+)\s*\}\}/g, (all, n: string) => params[Number(n) - 1] ?? all);
}

/** WhatsApp parametre kuralları: boş olamaz, satır sonu/sekme ve 4'ten fazla ardışık boşluk içeremez. */
export function validateTemplateParams(params: string[], expected: number): string | null {
  if (expected < 0) return "Bu şablon CRM'den gönderilemez.";
  if (params.length !== expected) return `Şablon ${expected} değişken bekliyor.`;
  for (const [i, p] of params.entries()) {
    if (!p.trim()) return `{{${i + 1}}} boş olamaz.`;
    if (/[\n\r\t]/.test(p) || / {5,}/.test(p)) return `{{${i + 1}}} satır sonu, sekme ya da 4'ten fazla ardışık boşluk içeremez.`;
    if (p.length > 1024) return `{{${i + 1}}} çok uzun.`;
  }
  return null;
}

// ───────────── Google Takvim ─────────────

/** Randevu kimliğinden türetilmiş etkinlik kimliği (Google base32hex: a–v, 0–9; 5–1024 karakter). */
export const googleEventId = (appointmentId: string) => `bcrm${appointmentId.replace(/-/g, "").toLowerCase()}`;
