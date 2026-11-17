import "server-only";
import type { IntegrationProvider } from "@prisma/client";
import { env } from "@/lib/env";

/** WhatsApp'ın hangi sağlayıcı üzerinden bağlandığı (.env WHATSAPP_PROVIDER). */
export const whatsappProvider = () => env().WHATSAPP_PROVIDER;

const WHATSAPP_ENV = {
  meta: ["META_APP_SECRET", "META_VERIFY_TOKEN", "WHATSAPP_ACCESS_TOKEN", "WHATSAPP_PHONE_NUMBER_ID", "WHATSAPP_BUSINESS_ACCOUNT_ID"],
  "360dialog": ["D360_API_KEY", "D360_WEBHOOK_SECRET"],
} as const;

/** Her kanal için gereken .env anahtarları (yalnız ADLAR; değerler hiçbir yerde gösterilmez). */
export function requiredEnv(provider: IntegrationProvider): readonly string[] | null {
  switch (provider) {
    case "META_LEAD_ADS":
      return ["META_APP_SECRET", "META_VERIFY_TOKEN", "META_ACCESS_TOKEN"];
    case "INSTAGRAM_DM":
      return ["META_APP_SECRET", "META_VERIFY_TOKEN", "INSTAGRAM_ACCOUNT_ID"];
    case "WHATSAPP":
      return WHATSAPP_ENV[whatsappProvider()];
    case "GOOGLE_CALENDAR":
      return ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"];
    default:
      return null;
  }
}

export function missingEnv(provider: IntegrationProvider): string[] {
  const e = env() as Record<string, unknown>;
  return (requiredEnv(provider) ?? []).filter((k) => {
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

export type WhatsappConfig =
  | { provider: "meta"; token: string; phoneNumberId: string; wabaId: string }
  | { provider: "360dialog"; apiKey: string; webhookSecret: string; phoneNumberId: string | null };

export function whatsappConfig(): WhatsappConfig | null {
  const e = env();
  if (!isConfigured("WHATSAPP")) return null;
  if (e.WHATSAPP_PROVIDER === "360dialog") {
    // 360dialog anahtarı tek numaraya bağlıdır; numara kimliği isteğe bağlı (yalnız başka numaranın olaylarını elemek için).
    if (e.D360_WEBHOOK_SECRET!.length < 32) return null;
    return { provider: "360dialog", apiKey: e.D360_API_KEY!, webhookSecret: e.D360_WEBHOOK_SECRET!, phoneNumberId: e.WHATSAPP_PHONE_NUMBER_ID || null };
  }
  return { provider: "meta", token: e.WHATSAPP_ACCESS_TOKEN!, phoneNumberId: e.WHATSAPP_PHONE_NUMBER_ID!, wabaId: e.WHATSAPP_BUSINESS_ACCOUNT_ID! };
}
