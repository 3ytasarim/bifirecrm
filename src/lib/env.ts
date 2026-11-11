import "server-only";
import { z } from "zod";

/**
 * Sunucu ortam değişkenleri tek yerden, tipli ve doğrulanmış okunur.
 * Eksik/yanlış değerde uygulama açık bir hata ile durur; sahte "bağlandı" davranışı yoktur.
 */
const schema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL tanımlı değil"),
  APP_URL: z.string().url(),
  APP_ENV: z.enum(["development", "staging", "production"]).default("development"),
  SESSION_SECRET: z.string().min(32, "SESSION_SECRET en az 32 karakter olmalı"),
  FILE_URL_SECRET: z.string().min(32, "FILE_URL_SECRET en az 32 karakter olmalı"),
  DATA_ENCRYPTION_KEY: z.string().min(32, "DATA_ENCRYPTION_KEY en az 32 karakter olmalı"),
  STORAGE_DRIVER: z.enum(["local", "s3"]).default("local"),
  LOCAL_STORAGE_DIR: z.string().default("./storage/private"),
  S3_ENDPOINT: z.string().optional(),
  S3_REGION: z.string().optional(),
  S3_BUCKET: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  SMTP_URL: z.string().optional(),
  SMTP_FROM: z.string().optional(),
  MAX_UPLOAD_MB: z.coerce.number().int().positive().max(100).default(20),
  WEBSITE_HMAC_SECRET: z.string().optional(),
});

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

export function env(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Ortam değişkenleri geçersiz: ${msg}`);
  }
  const e = parsed.data;
  if (e.APP_ENV === "production" && !e.APP_URL.startsWith("https://")) {
    throw new Error("Production ortamında APP_URL https olmalı");
  }
  if (e.STORAGE_DRIVER === "s3" && !(e.S3_BUCKET && e.S3_ACCESS_KEY_ID && e.S3_SECRET_ACCESS_KEY && e.S3_ENDPOINT)) {
    throw new Error("STORAGE_DRIVER=s3 için S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY gerekli");
  }
  cached = e;
  return e;
}

export const isProduction = () => env().APP_ENV === "production";
