import "server-only";
import { env } from "@/lib/env";

/**
 * Ekip içi e-posta (davet, şifre sıfırlama, görev bildirimi). Müşteriye e-posta GÖNDERİLMEZ.
 * SMTP_URL yoksa gönderim yapılmaz ve false döner — çağıran taraf kullanıcıya dürüstçe bildirir.
 */
export function mailConfigured() {
  return Boolean(env().SMTP_URL && env().SMTP_FROM);
}

export async function sendInternalMail(to: string, subject: string, text: string): Promise<boolean> {
  if (!mailConfigured()) return false;
  const nodemailer = await import("nodemailer");
  const transport = nodemailer.createTransport(env().SMTP_URL);
  await transport.sendMail({ from: env().SMTP_FROM, to, subject, text });
  return true;
}
