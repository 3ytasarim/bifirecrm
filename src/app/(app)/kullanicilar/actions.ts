"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Role } from "@prisma/client";
import { prisma } from "@/lib/db";
import { audit } from "@/lib/audit";
import { failure, fieldErrors, formObject, type ActionState } from "@/lib/action";
import { assertCan, getActorOrNull, invalidatePermissionCache, ForbiddenError } from "@/lib/rbac/guard";
import { ALL_PERMISSIONS, DEFAULT_MATRIX, LOCKED_PERMISSIONS, ROLE_LABELS, type Permission } from "@/lib/rbac/permissions";
import { issueAuthToken } from "@/lib/auth/tokens";
import { revokeAllSessions } from "@/lib/auth/session";
import { normalizeEmail } from "@/lib/normalize";
import { sendInternalMail } from "@/lib/mailer";

const NO_SESSION: ActionState = { ok: false, message: "Oturumunuz sona erdi. Lütfen yeniden giriş yapın." };
/** Yönetici olmayanların atayamayacağı roller (yetki yükseltme koruması). */
const PRIVILEGED: Role[] = ["SUPER_ADMIN", "MANAGER"];

const inviteSchema = z.object({
  name: z.string().trim().min(2, "Ad soyad yazın.").max(120),
  email: z
    .string()
    .trim()
    .transform((v) => normalizeEmail(v))
    .refine((v): v is string => !!v, "Geçerli bir e-posta yazın."),
  role: z.enum(Role),
});

export async function inviteUser(_: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await getActorOrNull();
  if (!actor) return NO_SESSION;
  const parsed = inviteSchema.safeParse(formObject(fd));
  if (!parsed.success) return { ok: false, errors: fieldErrors(parsed.error) };
  try {
    assertCan(actor, "users.manage");
    if (PRIVILEGED.includes(parsed.data.role) && !actor.perms.has("roles.manage")) throw new ForbiddenError("Bu rolü yalnız süper yönetici atayabilir.");
    const exists = await prisma.user.findUnique({ where: { email: parsed.data.email } });
    if (exists) return { ok: false, errors: { email: "Bu e-posta ile kullanıcı zaten var." } };
    const user = await prisma.user.create({ data: { name: parsed.data.name, email: parsed.data.email, role: parsed.data.role, status: "INVITED" } });
    const link = await issueAuthToken(user.id, "INVITE", actor.id);
    const sent = await sendInternalMail(user.email, "Bifire CRM daveti", `Merhaba ${user.name},\n\nBifire CRM'e davet edildiniz. Şifrenizi belirlemek için (7 gün geçerli):\n\n${link}\n`).catch(() => false);
    await audit({ actorId: actor.id, action: "user_invited", entityType: "user", entityId: user.id, summary: `${user.email} (${ROLE_LABELS[user.role]})`, after: { role: user.role, emailSent: sent } });
    revalidatePath("/kullanicilar");
    return sent
      ? { ok: true, message: `Davet e-postası ${user.email} adresine gönderildi.` }
      : { ok: true, message: "Kullanıcı oluşturuldu. E-posta (SMTP) yapılandırılmadığı için davet bağlantısını kendiniz güvenli kanaldan iletin:", data: { link } };
  } catch (e) {
    return failure(e);
  }
}

export async function resetLink(_: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await getActorOrNull();
  if (!actor) return NO_SESSION;
  try {
    assertCan(actor, "users.manage");
    const user = await prisma.user.findUnique({ where: { id: String(fd.get("id")) } });
    if (!user || user.status === "DISABLED") return { ok: false, message: "Kullanıcı bulunamadı ya da pasif." };
    if (user.role === "SUPER_ADMIN" && actor.role !== "SUPER_ADMIN") throw new ForbiddenError();
    const type = user.status === "INVITED" ? "INVITE" : "PASSWORD_RESET";
    const link = await issueAuthToken(user.id, type, actor.id);
    const sent = await sendInternalMail(user.email, "Bifire CRM şifre bağlantısı", `Şifre belirleme bağlantınız:\n\n${link}\n`).catch(() => false);
    await audit({ actorId: actor.id, action: "password_reset_requested", entityType: "user", entityId: user.id, summary: `Yönetici tarafından (${sent ? "e-posta" : "elle iletilecek"})` });
    return sent ? { ok: true, message: "Bağlantı e-postayla gönderildi." } : { ok: true, message: `Bağlantı oluşturuldu (${type === "INVITE" ? "7 gün" : "1 saat"} geçerli). Güvenli kanaldan iletin:`, data: { link } };
  } catch (e) {
    return failure(e);
  }
}

const updateSchema = z.object({ id: z.string().uuid(), role: z.enum(Role), status: z.enum(["ACTIVE", "DISABLED", "INVITED"]) });

export async function updateUser(_: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await getActorOrNull();
  if (!actor) return NO_SESSION;
  const parsed = updateSchema.safeParse(formObject(fd));
  if (!parsed.success) return { ok: false, message: "Geçersiz istek." };
  try {
    assertCan(actor, "users.manage");
    const { id, role, status } = parsed.data;
    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) return { ok: false, message: "Kullanıcı bulunamadı." };
    if (id === actor.id && (role !== user.role || status !== user.status)) return { ok: false, message: "Kendi rolünüzü veya durumunuzu değiştiremezsiniz." };
    if (role !== user.role) {
      assertCan(actor, "roles.manage");
    }
    if ((user.role === "SUPER_ADMIN" || PRIVILEGED.includes(role)) && !actor.perms.has("roles.manage")) throw new ForbiddenError("Yönetici hesaplarını yalnız süper yönetici değiştirebilir.");
    // Son aktif süper yöneticinin rolü/durumu düşürülemez (kilitlenme koruması).
    if (user.role === "SUPER_ADMIN" && (role !== "SUPER_ADMIN" || status === "DISABLED")) {
      const others = await prisma.user.count({ where: { role: "SUPER_ADMIN", status: "ACTIVE", id: { not: id } } });
      if (others === 0) return { ok: false, message: "Son aktif süper yönetici değiştirilemez." };
    }
    const nextStatus = status === "INVITED" && user.status !== "INVITED" ? user.status : status;
    await prisma.user.update({ where: { id }, data: { role, status: nextStatus } });
    if (nextStatus === "DISABLED") await revokeAllSessions(id);
    if (role !== user.role) {
      await audit({ actorId: actor.id, action: "role_change", entityType: "user", entityId: id, summary: `${user.email}: ${ROLE_LABELS[user.role]} → ${ROLE_LABELS[role]}`, before: { role: user.role }, after: { role } });
    }
    if (nextStatus !== user.status) {
      await audit({ actorId: actor.id, action: "user_updated", entityType: "user", entityId: id, summary: `${user.email}: ${user.status} → ${nextStatus}`, before: { status: user.status }, after: { status: nextStatus } });
    }
    revalidatePath("/kullanicilar");
    return { ok: true, message: "Kullanıcı güncellendi." };
  } catch (e) {
    return failure(e);
  }
}

export async function revokeSessionsAction(fd: FormData) {
  const actor = await getActorOrNull();
  if (!actor) return;
  assertCan(actor, "users.manage");
  const id = String(fd.get("id"));
  await revokeAllSessions(id);
  await audit({ actorId: actor.id, action: "sessions_revoked", entityType: "user", entityId: id });
  revalidatePath("/kullanicilar");
}

/** İzin matrisi: varsayılandan farklı olan hücreler role_permissions'a yazılır; varsayılana dönen hücre silinir. */
export async function savePermissions(_: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await getActorOrNull();
  if (!actor) return NO_SESSION;
  try {
    assertCan(actor, "roles.manage");
    const changes: { role: Role; permission: Permission; granted: boolean }[] = [];
    for (const role of Object.keys(ROLE_LABELS) as Role[]) {
      if (role === "SUPER_ADMIN") continue;
      for (const p of ALL_PERMISSIONS) {
        if (LOCKED_PERMISSIONS.includes(p)) continue;
        const granted = fd.get(`${role}:${p}`) === "on";
        if (granted !== DEFAULT_MATRIX[role].has(p)) changes.push({ role, permission: p, granted });
      }
    }
    const before = await prisma.rolePermission.findMany();
    await prisma.$transaction(async (t) => {
      await t.rolePermission.deleteMany({});
      const rows = changes;
      if (rows.length) await t.rolePermission.createMany({ data: rows.map((r) => ({ ...r, updatedById: actor.id })) });
      await audit(
        {
          actorId: actor.id,
          action: "permission_change",
          entityType: "role_permissions",
          summary: `${rows.length} değişiklik (varsayılandan farklı)`,
          before: before.map((b) => `${b.role}:${b.permission}=${b.granted}`),
          after: rows.map((r) => `${r.role}:${r.permission}=${r.granted}`),
        },
        t,
      );
    });
    invalidatePermissionCache();
    revalidatePath("/", "layout");
    return { ok: true, message: "İzinler kaydedildi. Değişiklik kullanıcıların bir sonraki isteğinde geçerli olur." };
  } catch (e) {
    return failure(e);
  }
}
