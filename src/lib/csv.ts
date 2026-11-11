/**
 * Excel (TR yerel ayarı) uyumlu CSV: UTF-8 BOM + noktalı virgül ayırıcı.
 * Formül enjeksiyonu (CSV injection) koruması: = + - @ ile başlayan hücreler tırnak işaretiyle etkisizleştirilir.
 */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  let s = value instanceof Date ? value.toISOString() : typeof value === "object" && value !== null && "toFixed" in value ? String(value) : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  if (/[";\r\n]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  const lines = [headers.map(csvCell).join(";"), ...rows.map((r) => r.map(csvCell).join(";"))];
  return "﻿" + lines.join("\r\n") + "\r\n";
}
