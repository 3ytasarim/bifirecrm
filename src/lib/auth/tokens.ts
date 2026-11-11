import "server-only";
import type { AuthTokenType } from "@prisma/client";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { randomToken, sha256 } from "@/lib/crypto";

const TTL: Record<AuthTokenType, number> = {
  INVITE: 7 * 24 * 3600_000,
  PASSWORD_RESET: 60 * 60_000,
};

/** Tek kullanımlık davet / sıfırlama bağlantısı. Aynı türdeki eski açık bağlantılar geçersiz kılınır. */
export async function issueAuthToken(userId: string, type: AuthTokenType, createdById: string | null) {
  const token = randomToken(32);
  await prisma.$transaction([
    prisma.authToken.updateMany({ where: { userId, type, usedAt: null }, data: { usedAt: new Date() } }),
    prisma.authToken.create({ data: { userId, type, tokenHash: sha256(token), createdById, expiresAt: new Date(Date.now() + TTL[type]) } }),
  ]);
  return `${env().APP_URL}/sifre-belirle?token=${token}`;
}

export async function findValidToken(token: string) {
  if (!token || token.length < 20) return null;
  const row = await prisma.authToken.findUnique({ where: { tokenHash: sha256(token) }, include: { user: { select: { id: true, email: true, name: true, status: true } } } });
  if (!row || row.usedAt || row.expiresAt < new Date()) return null;
  if (row.user.status === "DISABLED") return null;
  return row;
}
