/**
 * 360dialog webhook kaydı (WhatsApp coexistence). Sırlar ekrana basılmaz.
 *
 *   npx tsx --conditions=react-server scripts/d360-webhook.ts            # mevcut kaydı gösterir (değiştirmez)
 *   npx tsx --conditions=react-server scripts/d360-webhook.ts --apply    # {APP_URL}/api/v1/webhooks/whatsapp-360dialog kaydeder
 *
 * Kayıtta X-Bifire-Webhook-Token = D360_WEBHOOK_SECRET başlığı verilir; 360dialog her bildirimde bu başlığı gönderir,
 * CRM ucu başlık eşleşmeden gövdeyi işlemez. Adres https olmalı, port/alt çizgi içermemeli (360dialog şartı).
 */
import "dotenv/config";
import { env } from "@/lib/env";
import { d360Request } from "@/lib/integrations/whatsapp-client";

const PATH = "/api/v1/webhooks/whatsapp-360dialog";

async function main() {
  const e = env();
  if (e.WHATSAPP_PROVIDER !== "360dialog") throw new Error("WHATSAPP_PROVIDER=360dialog değil.");
  const apiKey = e.D360_API_KEY ?? "";
  const secret = e.D360_WEBHOOK_SECRET ?? "";
  if (!apiKey) throw new Error("D360_API_KEY tanımlı değil.");
  if (secret.length < 32) throw new Error("D360_WEBHOOK_SECRET en az 32 karakter olmalı (openssl rand -base64 48).");

  const current = await d360Request<{ url?: string; headers?: Record<string, string> }>("v1/configs/webhook", { apiKey });
  const target = e.APP_URL.replace(/\/$/, "") + PATH;
  const headerOk = current.headers?.["X-Bifire-Webhook-Token"] === secret;
  console.log(`Kayıtlı adres: ${current.url ?? "(yok)"}`);
  console.log(`Doğrulama başlığı: ${current.headers?.["X-Bifire-Webhook-Token"] ? (headerOk ? "doğru" : "FARKLI") : "(yok)"}`);
  console.log(`Hedef adres:   ${target}`);

  if (!process.argv.includes("--apply")) {
    console.log(current.url === target && headerOk ? "Durum: kayıt güncel." : "Durum: kayıt güncel DEĞİL. Uygulamak için --apply ekleyin.");
    return;
  }
  const u = new URL(target);
  if (u.protocol !== "https:" || u.port || u.hostname.includes("_")) throw new Error("Adres https olmalı, port ve alt çizgi içermemeli (APP_URL'i kontrol edin).");
  await d360Request("v1/configs/webhook", { apiKey, method: "POST", body: { url: target, headers: { "X-Bifire-Webhook-Token": secret } } });
  console.log("Webhook kaydedildi. Telefondan kendi numaranıza bir test mesajı gönderin → CRM › Mesajlar.");
}

main().catch((err) => {
  console.error("Hata:", err instanceof Error ? err.message : err);
  process.exit(1);
});
