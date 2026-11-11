import { z } from "zod";

/** Server action'ların tek tip dönüşü. Alan hataları formda ilgili alanın altında gösterilir. */
export type ActionState = {
  ok?: boolean;
  message?: string;
  errors?: Record<string, string>;
  /** Başarılı işlemden sonra istemcinin gideceği adres (ör. yeni kayıt). */
  redirectTo?: string;
  /** Sunucunun döndürdüğü ek veri (ör. eşleşme adayları). */
  data?: unknown;
};

export const initialState: ActionState = {};

export function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "_";
    out[key] ??= issue.message;
  }
  return out;
}

export function formObject(fd: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of fd.entries()) if (typeof v === "string" && !k.startsWith("$ACTION")) out[k] = v;
  return out;
}

/** Bilinen iş kuralı hatalarını kullanıcıya göster, beklenmeyenleri gizleyip logla. */
export function failure(e: unknown): ActionState {
  if (e instanceof Error && (e.name === "ForbiddenError" || /bulunamadı|zorunlu|yalnız|geçersiz|aktif değil|erişiminiz|yetkiniz|kendisiyle|Onaylanacak|desteklenmiyor|MB|işlenemedi|zararlı|boş/i.test(e.message))) {
    return { ok: false, message: e.message };
  }
  console.error("[action]", e);
  return { ok: false, message: "Beklenmeyen bir hata oluştu. Lütfen tekrar deneyin." };
}

// ── Ortak alan doğrulayıcıları ──
export const zText = (max = 200) => z.string().trim().max(max, `En fazla ${max} karakter.`);
export const zOptional = (max = 200) =>
  z
    .string()
    .trim()
    .max(max, `En fazla ${max} karakter.`)
    .optional()
    .transform((v) => (v ? v : null));
export const zUuidOpt = z
  .string()
  .optional()
  .transform((v) => (v ? v : null))
  .refine((v) => v === null || /^[0-9a-f-]{36}$/i.test(v), "Geçersiz seçim.");
export const zMoney = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v ? v.replace(/\./g, "").replace(",", ".").replace(/\s|₺/g, "") : null))
  .refine((v) => v === null || (/^\d{1,12}(\.\d{1,2})?$/.test(v)), "Geçerli bir tutar yazın (ör. 125000 veya 125.000,50).");
export const zDecimal = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v ? v.replace(",", ".") : null))
  .refine((v) => v === null || /^\d{1,6}(\.\d)?$/.test(v), "Geçerli bir ölçü yazın (cm).");
export const zCheckbox = z
  .string()
  .optional()
  .transform((v) => v === "on" || v === "true");
