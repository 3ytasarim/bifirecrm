import type { SessionUser } from "@/lib/auth/session";
import type { Permission } from "./permissions";

/**
 * İstek bağlamına bağlı olmayan yetki kontrolleri. Servis katmanı bunu kullanır; böylece servisler
 * worker/betik sürecinde de (next/navigation yüklenmeden) çalışır. Oturum/yönlendirme: ./guard.ts.
 */
export type Actor = SessionUser & { perms: Set<Permission> };

export function can(actor: Actor, perm: Permission) {
  return actor.perms.has(perm);
}

export class ForbiddenError extends Error {
  constructor(message = "Bu işlem için yetkiniz yok.") {
    super(message);
    this.name = "ForbiddenError";
  }
}

export function assertCan(actor: Actor, perm: Permission) {
  if (!actor.perms.has(perm)) throw new ForbiddenError();
}
