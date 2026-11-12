import "server-only";
import type { IntegrationProvider, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { notify } from "@/lib/notifications";
import { PROVIDER_LABELS } from "@/lib/labels";
import { GraphError } from "./graph";

/**
 * Bağlantı durumu YALNIZ gerçek sonuçlardan türetilir: başarılı API çağrısı / imzası doğrulanmış olay → Aktif,
 * anahtar/izin hatası → Hata + yönetici bildirimi. Hiçbir yerde varsayımla "bağlandı" yazılmaz.
 */
export class TokenError extends Error {
  constructor(
    message: string,
    readonly provider: IntegrationProvider,
  ) {
    super(message);
    this.name = "TokenError";
  }
}

const day = (d = new Date()) => new Date(d.getTime() + 3 * 3600_000).toISOString().slice(0, 10);

export async function markConnectionOk(provider: IntegrationProvider, config?: Prisma.InputJsonValue) {
  const now = new Date();
  await prisma.integrationConnection.upsert({
    where: { provider },
    create: { provider, status: "ACTIVE", lastSyncAt: now, config },
    update: { status: "ACTIVE", lastSyncAt: now, ...(config !== undefined ? { config } : {}) },
  });
}

/** İmzası doğrulanmış olay alındı: son senkron güncellenir; anahtar hatası varken durum "Aktif"e çekilmez. */
export async function markEventReceived(provider: IntegrationProvider) {
  const now = new Date();
  const c = await prisma.integrationConnection.findUnique({ where: { provider }, select: { status: true } });
  if (!c) await prisma.integrationConnection.create({ data: { provider, status: "ACTIVE", lastSyncAt: now } }).catch(() => {});
  else await prisma.integrationConnection.update({ where: { provider }, data: { lastSyncAt: now, ...(c.status === "NOT_CONFIGURED" ? { status: "ACTIVE" } : {}) } });
}

export async function markConnectionError(provider: IntegrationProvider, message: string) {
  const now = new Date();
  const msg = message.slice(0, 500);
  await prisma.integrationConnection.upsert({
    where: { provider },
    create: { provider, status: "ERROR", lastErrorAt: now, lastError: msg },
    update: { status: "ERROR", lastErrorAt: now, lastError: msg },
  });
  const admins = await prisma.user.findMany({ where: { status: "ACTIVE", role: { in: ["SUPER_ADMIN", "MANAGER"] } }, select: { id: true } });
  for (const a of admins) {
    await notify({ userId: a.id, type: "integration_error", title: `${PROVIDER_LABELS[provider]} bağlantısı hata verdi`, body: msg, link: "/entegrasyonlar", dedupeKey: `integration-error:${provider}:${day(now)}` });
  }
}

/** Geçici hata (ağ, 5xx): durum değişmez, yalnız son hata yazılır; iş kuyruğu yeniden dener. */
export async function recordTransientError(provider: IntegrationProvider, message: string) {
  await prisma.integrationConnection
    .upsert({ where: { provider }, create: { provider, status: "NOT_CONFIGURED", lastErrorAt: new Date(), lastError: message.slice(0, 500) }, update: { lastErrorAt: new Date(), lastError: message.slice(0, 500) } })
    .catch(() => {});
}

/** Sağlayıcı hatasını sınıflandırır, durumu günceller ve hatayı yeniden fırlatır (iş kuyruğu retry/dead-letter yapar). */
export async function handleProviderError(provider: IntegrationProvider, e: unknown): Promise<never> {
  const message = e instanceof Error ? e.message : String(e);
  if ((e instanceof GraphError && e.auth) || e instanceof TokenError) await markConnectionError(provider, message);
  else await recordTransientError(provider, message);
  throw e;
}
