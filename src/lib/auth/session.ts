import "server-only";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import type { Role, User } from "@prisma/client";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { hmac, randomToken, sha256 } from "@/lib/crypto";

export const SESSION_COOKIE = "bcrm_session";
const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 saat (kayan)
const ABSOLUTE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // en fazla 7 gün
const TOUCH_INTERVAL_MS = 5 * 60 * 1000;

export type SessionUser = Pick<User, "id" | "email" | "name" | "role" | "status" | "mfaEnabled">;

export async function requestMeta() {
  const h = await headers();
  const ip = (h.get("x-forwarded-for")?.split(",")[0] ?? h.get("x-real-ip") ?? "").trim();
  return {
    ipHash: ip ? hmac(env().SESSION_SECRET, `ip:${ip}`).slice(0, 32) : null,
    userAgent: h.get("user-agent")?.slice(0, 300) ?? null,
  };
}

export async function createSession(userId: string, mfaPending: boolean) {
  const token = randomToken(32);
  const meta = await requestMeta();
  const now = Date.now();
  await prisma.session.create({
    data: {
      tokenHash: sha256(token),
      userId,
      mfaPending,
      ipHash: meta.ipHash,
      userAgent: meta.userAgent,
      expiresAt: new Date(now + SESSION_TTL_MS),
    },
  });
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: env().APP_URL.startsWith("https://"),
    sameSite: "lax",
    path: "/",
    maxAge: Math.floor(ABSOLUTE_TTL_MS / 1000),
  });
}

async function readSession() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const session = await prisma.session.findUnique({
    where: { tokenHash: sha256(token) },
    include: { user: { select: { id: true, email: true, name: true, role: true, status: true, mfaEnabled: true } } },
  });
  if (!session || session.revokedAt) return null;
  const now = Date.now();
  if (session.expiresAt.getTime() < now || session.createdAt.getTime() + ABSOLUTE_TTL_MS < now) return null;
  if (session.user.status !== "ACTIVE") return null;
  if (now - session.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
    // Kayan süre: aktif kullanıcının oturumu uzar. Hata oturumu bozmasın.
    await prisma.session
      .update({ where: { id: session.id }, data: { lastSeenAt: new Date(now), expiresAt: new Date(now + SESSION_TTL_MS) } })
      .catch(() => undefined);
  }
  return session;
}

/** İstek başına bir kez okunur (React cache). MFA bekleyen oturum tam oturum sayılmaz. */
export const getSession = cache(async () => {
  const s = await readSession();
  if (!s) return null;
  return { id: s.id, mfaPending: s.mfaPending, user: s.user as SessionUser };
});

export async function getCurrentUser(): Promise<SessionUser | null> {
  const s = await getSession();
  if (!s || s.mfaPending) return null;
  return s.user;
}

export async function destroyCurrentSession() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) {
    await prisma.session.updateMany({ where: { tokenHash: sha256(token), revokedAt: null }, data: { revokedAt: new Date() } });
  }
  jar.delete(SESSION_COOKIE);
}

export async function revokeAllSessions(userId: string, exceptSessionId?: string) {
  await prisma.session.updateMany({
    where: { userId, revokedAt: null, ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}) },
    data: { revokedAt: new Date() },
  });
}

export async function completeMfa(sessionId: string) {
  await prisma.session.update({ where: { id: sessionId }, data: { mfaPending: false } });
}

export type { Role };
