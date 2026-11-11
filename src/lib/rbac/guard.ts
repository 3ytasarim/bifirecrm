import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import type { Role } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/session";
import { effectivePermissions, type Override, type Permission } from "./permissions";
import type { Actor } from "./assert";

export { assertCan, can, ForbiddenError, type Actor } from "./assert";

let overridesCache: { at: number; rows: Override[] } | null = null;
const OVERRIDE_TTL_MS = 15_000;

export async function loadOverrides(): Promise<Override[]> {
  if (overridesCache && Date.now() - overridesCache.at < OVERRIDE_TTL_MS) return overridesCache.rows;
  const rows = await prisma.rolePermission.findMany({ select: { role: true, permission: true, granted: true } });
  overridesCache = { at: Date.now(), rows };
  return rows;
}

export function invalidatePermissionCache() {
  overridesCache = null;
}

export async function permissionsFor(role: Role) {
  return effectivePermissions(role, await loadOverrides());
}


/** Oturum açmış aktif kullanıcı + etkin izinleri. Yoksa girişe yönlendirir. */
export const requireActor = cache(async (): Promise<Actor> => {
  const user = await getCurrentUser();
  if (!user) redirect("/giris");
  return { ...user, perms: await permissionsFor(user.role) };
});

/** Server action / route handler için: yönlendirme yerine hata fırlatır. */
export async function getActorOrNull(): Promise<Actor | null> {
  const user = await getCurrentUser();
  if (!user) return null;
  return { ...user, perms: await permissionsFor(user.role) };
}

/** Sayfa düzeyinde: izin yoksa 403 sayfasına. */
export async function requirePermission(perm: Permission): Promise<Actor> {
  const actor = await requireActor();
  if (!actor.perms.has(perm)) redirect("/yetkisiz");
  return actor;
}
