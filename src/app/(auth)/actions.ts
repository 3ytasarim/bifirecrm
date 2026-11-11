"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { audit } from "@/lib/audit";
import { decrypt } from "@/lib/crypto";
import { rateLimit } from "@/lib/rate-limit";
import { fieldErrors, type ActionState } from "@/lib/action";
import { burnPasswordTime, hashPassword, passwordSchema, verifyPassword } from "@/lib/auth/password";
import { completeMfa, createSession, destroyCurrentSession, getSession, requestMeta, revokeAllSessions } from "@/lib/auth/session";
import { verifyTotp } from "@/lib/auth/totp";
import { findValidToken, issueAuthToken } from "@/lib/auth/tokens";
import { normalizeEmail } from "@/lib/normalize";
import { sendInternalMail } from "@/lib/mailer";

const LOCK_AFTER = 8;
const LOCK_MINUTES = 15;
const GENERIC = "E-posta veya şifre hatalı.";

export async function login(_: ActionState, fd: FormData): Promise<ActionState> {
  const email = normalizeEmail(String(fd.get("email") ?? ""));
  const password = String(fd.get("password") ?? "");
  if (!email || !password) return { ok: false, message: "E-posta ve şifrenizi yazın." };

  const meta = await requestMeta();
  const [byIp, byEmail] = await Promise.all([rateLimit(`login:ip:${meta.ipHash ?? "?"}`, 20, 900), rateLimit(`login:email:${email}`, 10, 900)]);
  if (!byIp.ok || !byEmail.ok) return { ok: false, message: "Çok fazla deneme yapıldı. Lütfen 15 dakika sonra tekrar deneyin." };

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !user.passwordHash || user.status !== "ACTIVE") {
    await burnPasswordTime(password);
    await audit({ actorId: user?.id ?? null, action: "login_failed", entityType: "user", entityId: user?.id, summary: user ? `Durum: ${user.status}` : `Bilinmeyen e-posta` });
    return { ok: false, message: GENERIC };
  }
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    return { ok: false, message: "Hesap çok sayıda hatalı deneme nedeniyle geçici olarak kilitlendi. 15 dakika sonra tekrar deneyin." };
  }
  if (!(await verifyPassword(user.passwordHash, password))) {
    const failed = user.failedLoginCount + 1;
    await prisma.user.update({
      where: { id: user.id },
      data: { failedLoginCount: failed >= LOCK_AFTER ? 0 : failed, lockedUntil: failed >= LOCK_AFTER ? new Date(Date.now() + LOCK_MINUTES * 60_000) : null },
    });
    await audit({ actorId: user.id, action: "login_failed", entityType: "user", entityId: user.id, summary: failed >= LOCK_AFTER ? "Hesap kilitlendi" : `Hatalı şifre (${failed})` });
    return { ok: false, message: GENERIC };
  }

  await prisma.user.update({ where: { id: user.id }, data: { failedLoginCount: 0, lockedUntil: null, ...(user.mfaEnabled ? {} : { lastLoginAt: new Date() }) } });
  await createSession(user.id, user.mfaEnabled);
  if (user.mfaEnabled) redirect("/giris/dogrulama");
  await audit({ actorId: user.id, action: "login", entityType: "user", entityId: user.id });
  const next = String(fd.get("next") ?? "");
  redirect(next.startsWith("/") && !next.startsWith("//") ? next : "/");
}

export async function verifyMfa(_: ActionState, fd: FormData): Promise<ActionState> {
  const session = await getSession();
  if (!session || !session.mfaPending) redirect("/giris");
  const rl = await rateLimit(`mfa:${session.id}`, 6, 900);
  if (!rl.ok) {
    await destroyCurrentSession();
    return { ok: false, message: "Çok fazla hatalı kod. Lütfen yeniden giriş yapın." };
  }
  const user = await prisma.user.findUnique({ where: { id: session.user.id }, select: { id: true, mfaSecretEnc: true } });
  const code = String(fd.get("code") ?? "");
  if (!user?.mfaSecretEnc || !verifyTotp(decrypt(user.mfaSecretEnc, env().DATA_ENCRYPTION_KEY), code)) {
    await audit({ actorId: session.user.id, action: "login_failed", entityType: "user", entityId: session.user.id, summary: "Hatalı MFA kodu" });
    return { ok: false, message: "Doğrulama kodu hatalı ya da süresi geçmiş." };
  }
  await completeMfa(session.id);
  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  await audit({ actorId: user.id, action: "login", entityType: "user", entityId: user.id, summary: "MFA ile" });
  redirect("/");
}

export async function logout() {
  const s = await getSession();
  if (s) await audit({ actorId: s.user.id, action: "logout", entityType: "user", entityId: s.user.id });
  await destroyCurrentSession();
  redirect("/giris");
}

export async function requestPasswordReset(_: ActionState, fd: FormData): Promise<ActionState> {
  const email = normalizeEmail(String(fd.get("email") ?? ""));
  const done: ActionState = {
    ok: true,
    message: "Bu e-posta ile kayıtlı aktif bir hesap varsa sıfırlama bağlantısı gönderildi. E-posta gelmezse yöneticinizden yeni bağlantı isteyin.",
  };
  if (!email) return { ok: false, errors: { email: "Geçerli bir e-posta adresi yazın." } };
  const meta = await requestMeta();
  const rl = await rateLimit(`reset:${meta.ipHash ?? "?"}`, 5, 3600);
  if (!rl.ok) return done;
  const user = await prisma.user.findUnique({ where: { email }, select: { id: true, email: true, status: true } });
  if (!user || user.status !== "ACTIVE") return done;
  const link = await issueAuthToken(user.id, "PASSWORD_RESET", null);
  const sent = await sendInternalMail(user.email, "Bifire CRM şifre sıfırlama", `Şifrenizi sıfırlamak için bağlantı (1 saat geçerli):\n\n${link}\n\nBu isteği siz yapmadıysanız bu e-postayı yok sayın.`).catch(() => false);
  await audit({ actorId: user.id, action: "password_reset_requested", entityType: "user", entityId: user.id, summary: sent ? "E-posta gönderildi" : "SMTP yok — e-posta gönderilemedi" });
  return done;
}

const setPasswordSchema = z
  .object({ token: z.string().min(20), password: passwordSchema, confirm: z.string() })
  .refine((v) => v.password === v.confirm, { path: ["confirm"], message: "Şifreler eşleşmiyor." });

export async function setPassword(_: ActionState, fd: FormData): Promise<ActionState> {
  const parsed = setPasswordSchema.safeParse({ token: fd.get("token"), password: fd.get("password"), confirm: fd.get("confirm") });
  if (!parsed.success) return { ok: false, errors: fieldErrors(parsed.error) };
  const row = await findValidToken(parsed.data.token);
  if (!row) return { ok: false, message: "Bağlantı geçersiz ya da süresi dolmuş. Yöneticinizden yeni bağlantı isteyin." };
  const passwordHash = await hashPassword(parsed.data.password);
  await prisma.$transaction([
    prisma.user.update({ where: { id: row.userId }, data: { passwordHash, status: "ACTIVE", failedLoginCount: 0, lockedUntil: null } }),
    prisma.authToken.update({ where: { id: row.id }, data: { usedAt: new Date() } }),
  ]);
  await revokeAllSessions(row.userId);
  await audit({ actorId: row.userId, action: "password_set", entityType: "user", entityId: row.userId, summary: row.type === "INVITE" ? "Davet kabul edildi" : "Şifre sıfırlandı" });
  // Sunucu yönlendirmesi: JS yüklenmeden gönderilen formda da doğru sayfaya gider.
  redirect("/giris?sifre=tamam");
}
