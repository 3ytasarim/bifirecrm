"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { audit } from "@/lib/audit";
import { decrypt, encrypt } from "@/lib/crypto";
import { fieldErrors, type ActionState } from "@/lib/action";
import { getActorOrNull } from "@/lib/rbac/guard";
import { getSession, revokeAllSessions } from "@/lib/auth/session";
import { hashPassword, passwordSchema, verifyPassword } from "@/lib/auth/password";
import { generateTotpSecret, verifyTotp } from "@/lib/auth/totp";
import { rateLimit } from "@/lib/rate-limit";

const NO_SESSION: ActionState = { ok: false, message: "Oturumunuz sona erdi. Lütfen yeniden giriş yapın." };

const pwSchema = z
  .object({ current: z.string().min(1, "Mevcut şifrenizi yazın."), password: passwordSchema, confirm: z.string() })
  .refine((v) => v.password === v.confirm, { path: ["confirm"], message: "Şifreler eşleşmiyor." });

export async function changePassword(_: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await getActorOrNull();
  if (!actor) return NO_SESSION;
  const parsed = pwSchema.safeParse({ current: fd.get("current"), password: fd.get("password"), confirm: fd.get("confirm") });
  if (!parsed.success) return { ok: false, errors: fieldErrors(parsed.error) };
  const rl = await rateLimit(`pwchange:${actor.id}`, 5, 900);
  if (!rl.ok) return { ok: false, message: "Çok fazla deneme. 15 dakika sonra tekrar deneyin." };
  const user = await prisma.user.findUnique({ where: { id: actor.id }, select: { passwordHash: true } });
  if (!user?.passwordHash || !(await verifyPassword(user.passwordHash, parsed.data.current))) return { ok: false, errors: { current: "Mevcut şifre hatalı." } };
  await prisma.user.update({ where: { id: actor.id }, data: { passwordHash: await hashPassword(parsed.data.password) } });
  const s = await getSession();
  await revokeAllSessions(actor.id, s?.id);
  await audit({ actorId: actor.id, action: "password_set", entityType: "user", entityId: actor.id, summary: "Kullanıcı şifresini değiştirdi; diğer oturumlar kapatıldı" });
  return { ok: true, message: "Şifreniz değiştirildi. Diğer cihazlardaki oturumlar kapatıldı." };
}

/** MFA kurulumu 1. adım: yeni sır üret (henüz etkin değil). */
export async function startMfa(): Promise<ActionState> {
  const actor = await getActorOrNull();
  if (!actor) return NO_SESSION;
  const secret = generateTotpSecret();
  await prisma.user.update({ where: { id: actor.id }, data: { mfaSecretEnc: encrypt(secret, env().DATA_ENCRYPTION_KEY), mfaEnabled: false } });
  revalidatePath("/ayarlar");
  return { ok: true };
}

export async function confirmMfa(_: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await getActorOrNull();
  if (!actor) return NO_SESSION;
  const user = await prisma.user.findUnique({ where: { id: actor.id }, select: { mfaSecretEnc: true, mfaEnabled: true } });
  if (!user?.mfaSecretEnc) return { ok: false, message: "Önce kurulumu başlatın." };
  if (!verifyTotp(decrypt(user.mfaSecretEnc, env().DATA_ENCRYPTION_KEY), String(fd.get("code") ?? ""))) return { ok: false, errors: { code: "Kod hatalı. Uygulamadaki güncel kodu girin." } };
  await prisma.user.update({ where: { id: actor.id }, data: { mfaEnabled: true } });
  await audit({ actorId: actor.id, action: "mfa_enabled", entityType: "user", entityId: actor.id });
  revalidatePath("/ayarlar");
  return { ok: true, message: "İki adımlı doğrulama açıldı. Sonraki girişlerde kod istenecek." };
}

export async function disableMfa(_: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await getActorOrNull();
  if (!actor) return NO_SESSION;
  const user = await prisma.user.findUnique({ where: { id: actor.id }, select: { mfaSecretEnc: true, mfaEnabled: true } });
  if (!user?.mfaEnabled || !user.mfaSecretEnc) return { ok: false, message: "MFA zaten kapalı." };
  if (!verifyTotp(decrypt(user.mfaSecretEnc, env().DATA_ENCRYPTION_KEY), String(fd.get("code") ?? ""))) return { ok: false, errors: { code: "Kod hatalı." } };
  await prisma.user.update({ where: { id: actor.id }, data: { mfaEnabled: false, mfaSecretEnc: null } });
  await audit({ actorId: actor.id, action: "mfa_disabled", entityType: "user", entityId: actor.id });
  revalidatePath("/ayarlar");
  return { ok: true, message: "İki adımlı doğrulama kapatıldı." };
}

export async function cancelMfaSetup() {
  const actor = await getActorOrNull();
  if (!actor) return;
  await prisma.user.updateMany({ where: { id: actor.id, mfaEnabled: false }, data: { mfaSecretEnc: null } });
  revalidatePath("/ayarlar");
}

export async function revokeSession(fd: FormData) {
  const actor = await getActorOrNull();
  if (!actor) return;
  await prisma.session.updateMany({ where: { id: String(fd.get("id")), userId: actor.id, revokedAt: null }, data: { revokedAt: new Date() } });
  await audit({ actorId: actor.id, action: "sessions_revoked", entityType: "session", entityId: String(fd.get("id")) });
  revalidatePath("/ayarlar");
}

export async function toggleEmailNotifications(fd: FormData) {
  const actor = await getActorOrNull();
  if (!actor) return;
  await prisma.user.update({ where: { id: actor.id }, data: { emailNotifications: fd.get("on") === "1" } });
  revalidatePath("/ayarlar");
}

/** Web formu taleplerinin otomatik atanacağı kullanıcı (boş = atama yok, yöneticilere bildirim). */
export async function saveWebsiteOwner(fd: FormData) {
  const actor = await getActorOrNull();
  if (!actor || !actor.perms.has("settings.manage")) return;
  const raw = String(fd.get("ownerId") ?? "");
  const before = await prisma.setting.findUnique({ where: { key: "intake.website_owner_id" } });
  if (!raw) {
    await prisma.setting.deleteMany({ where: { key: "intake.website_owner_id" } });
  } else {
    const user = await prisma.user.findFirst({ where: { id: raw, status: "ACTIVE" }, select: { id: true } });
    if (!user) return;
    await prisma.setting.upsert({ where: { key: "intake.website_owner_id" }, create: { key: "intake.website_owner_id", value: user.id, updatedById: actor.id }, update: { value: user.id, updatedById: actor.id } });
  }
  await audit({ actorId: actor.id, action: "setting_changed", entityType: "setting", entityId: "intake.website_owner_id", before: { value: before?.value ?? null }, after: { value: raw || null } });
  revalidatePath("/ayarlar");
}
