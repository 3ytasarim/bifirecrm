export const TZ = "Europe/Istanbul";

const dateFmt = new Intl.DateTimeFormat("tr-TR", { timeZone: TZ, day: "2-digit", month: "2-digit", year: "numeric" });
const dateTimeFmt = new Intl.DateTimeFormat("tr-TR", { timeZone: TZ, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
const relFmt = new Intl.RelativeTimeFormat("tr-TR", { numeric: "auto" });

export function fmtDate(d: Date | string | null | undefined) {
  if (!d) return "—";
  return dateFmt.format(new Date(d));
}

export function fmtDateTime(d: Date | string | null | undefined) {
  if (!d) return "—";
  return dateTimeFmt.format(new Date(d));
}

export function fmtRelative(d: Date | string | null | undefined, now = Date.now()) {
  if (!d) return "—";
  const diff = new Date(d).getTime() - now;
  const abs = Math.abs(diff);
  const min = 60_000;
  const hour = 60 * min;
  const day = 24 * hour;
  if (abs < hour) return relFmt.format(Math.round(diff / min), "minute");
  if (abs < day) return relFmt.format(Math.round(diff / hour), "hour");
  if (abs < 30 * day) return relFmt.format(Math.round(diff / day), "day");
  return fmtDate(d);
}

export function fmtMoney(amount: { toString(): string } | number | null | undefined, currency = "TRY") {
  if (amount === null || amount === undefined) return "—";
  const n = typeof amount === "number" ? amount : Number(amount.toString());
  return new Intl.NumberFormat("tr-TR", { style: "currency", currency, maximumFractionDigits: 0 }).format(n);
}

/** Europe/Istanbul'daki "YYYY-MM-DDTHH:mm" yerel değerini UTC Date'e çevirir (datetime-local input). */
export function istanbulLocalToDate(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
  // Türkiye 2016'dan beri sabit UTC+3 (yaz saati yok).
  return new Date(`${value}:00+03:00`);
}

export function dateToIstanbulLocal(d: Date | null | undefined): string {
  if (!d) return "";
  const shifted = new Date(d.getTime() + 3 * 60 * 60 * 1000);
  return shifted.toISOString().slice(0, 16);
}

/** "YYYY-MM-DD" (date input) → Date (UTC gece yarısı; @db.Date alanları için). */
export function parseDateOnly(value: string | null | undefined): Date | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  return new Date(`${value}T00:00:00.000Z`);
}

export function dateOnlyValue(d: Date | null | undefined) {
  return d ? d.toISOString().slice(0, 10) : "";
}

/** İstanbul'da bugünün başlangıcı (UTC Date). */
export function startOfTodayIstanbul(now = new Date()) {
  const local = new Date(now.getTime() + 3 * 3600_000);
  local.setUTCHours(0, 0, 0, 0);
  return new Date(local.getTime() - 3 * 3600_000);
}

export const code = {
  contact: (n: number) => `M-${String(n).padStart(6, "0")}`,
  opportunity: (n: number) => `F-${String(n).padStart(6, "0")}`,
  project: (n: number) => `P-${String(n).padStart(6, "0")}`,
  quote: (n: number) => `T-${String(n).padStart(6, "0")}`,
};

/** Sunucu bileşenlerinde istek anı (React Compiler saf olmayan çağrıyı render içinde istemez). */
export function nowMs(): number {
  return Date.now();
}

export function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 86400_000);
}
