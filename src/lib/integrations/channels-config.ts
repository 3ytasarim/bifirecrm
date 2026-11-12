import "server-only";
import type { IntegrationProvider } from "@prisma/client";
import { env } from "@/lib/env";

/** Her kanal için gereken .env anahtarları (yalnız ADLAR; değerler hiçbir yerde gösterilmez). */
export const REQUIRED_ENV: Partial<Record<IntegrationProvider, string[]>> = {
  META_LEAD_ADS: ["META_APP_SECRET", "META_VERIFY_TOKEN", "META_ACCESS_TOKEN"],
  INSTAGRAM_DM: ["META_APP_SECRET", "META_VERIFY_TOKEN", "INSTAGRAM_ACCOUNT_ID"],
  WHATSAPP: ["META_APP_SECRET", "META_VERIFY_TOKEN", "WHATSAPP_ACCESS_TOKEN", "WHATSAPP_PHONE_NUMBER_ID", "WHATSAPP_BUSINESS_ACCOUNT_ID"],
  GOOGLE_CALENDAR: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"],
};

export function missingEnv(provider: IntegrationProvider): string[] {
  const e = env() as Record<string, unknown>;
  return (REQUIRED_ENV[provider] ?? []).filter((k) => {
    const v = e[k];
    return typeof v !== "string" || v.trim().length === 0;
  });
}

export const isConfigured = (provider: IntegrationProvider) => missingEnv(provider).length === 0;

/** Meta webhook ucu yalnız uygulama sırrı + doğrulama anahtarı tanımlıysa çalışır. */
export function metaWebhookSecrets() {
  const e = env();
  if (!e.META_APP_SECRET || !e.META_VERIFY_TOKEN) return null;
  return { appSecret: e.META_APP_SECRET, verifyToken: e.META_VERIFY_TOKEN };
}

export function whatsappConfig() {
  const e = env();
  if (!isConfigured("WHATSAPP")) return null;
  return { token: e.WHATSAPP_ACCESS_TOKEN!, phoneNumberId: e.WHATSAPP_PHONE_NUMBER_ID!, wabaId: e.WHATSAPP_BUSINESS_ACCOUNT_ID! };
}
