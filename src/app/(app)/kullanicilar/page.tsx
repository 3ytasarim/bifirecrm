import type { Role } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/rbac/guard";
import { ALL_PERMISSIONS, DEFAULT_MATRIX, effectivePermissions, LOCKED_PERMISSIONS, PERMISSIONS, ROLE_LABELS, ROLES } from "@/lib/rbac/permissions";
import { USER_STATUS_LABELS } from "@/lib/labels";
import { fmtDateTime } from "@/lib/format";
import { Badge, Card, PageHeader, tableCls } from "@/components/ui/primitives";
import { InviteForm, PermissionMatrix, UserRow } from "./forms";
import { revokeSessionsAction } from "./actions";

export const metadata = { title: "Kullanıcılar & Roller" };

export default async function UsersPage() {
  const actor = await requirePermission("users.manage");
  const canRoles = actor.perms.has("roles.manage");
  const [users, overrides, sessions, assigned] = await Promise.all([
    prisma.user.findMany({ orderBy: [{ status: "asc" }, { name: "asc" }] }),
    prisma.rolePermission.findMany(),
    prisma.session.groupBy({ by: ["userId"], where: { revokedAt: null, expiresAt: { gt: new Date() } }, _count: { _all: true } }),
    prisma.task.groupBy({ by: ["assigneeId"], where: { deletedAt: null, status: { in: ["OPEN", "IN_PROGRESS"] } }, _count: { _all: true } }),
  ]);
  const roleOpts = ROLES.filter((r) => canRoles || (r !== "SUPER_ADMIN" && r !== "MANAGER")).map((r) => ({ value: r, label: ROLE_LABELS[r] }));
  const matrix: Record<string, boolean> = {};
  const defaults: Record<string, boolean> = {};
  for (const r of ROLES) {
    const eff = effectivePermissions(r as Role, overrides);
    for (const p of ALL_PERMISSIONS) {
      matrix[`${r}:${p}`] = eff.has(p);
      defaults[`${r}:${p}`] = r === "SUPER_ADMIN" || DEFAULT_MATRIX[r as Role].has(p);
    }
  }

  return (
    <>
      <PageHeader title="Kullanıcılar & Roller" description="Ekip üyelerini davet edin, rollerini ve erişimlerini yönetin. Tüm değişiklikler denetim kaydına yazılır." />
      <div className="space-y-6">
        <Card title="Kullanıcı davet et">
          <InviteForm roles={roleOpts} />
        </Card>
        <Card title={`Ekip (${users.length})`} padded={false}>
          <div className={tableCls.wrap}>
            <table className={tableCls.table}>
              <thead>
                <tr>
                  <th className={tableCls.th}>Kullanıcı</th>
                  <th className={tableCls.th}>Rol / durum</th>
                  <th className={tableCls.th}>Güvenlik</th>
                  <th className={tableCls.th}>Açık görev</th>
                  <th className={tableCls.th}>Yönet</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => {
                  const sCount = sessions.find((s) => s.userId === u.id)?._count._all ?? 0;
                  return (
                    <tr key={u.id} className={tableCls.row}>
                      <td className={tableCls.td}>
                        <span className="block font-medium">{u.name}</span>
                        <span className="block text-xs text-muted">{u.email}</span>
                      </td>
                      <td className={tableCls.td}>
                        <Badge tone="accent">{ROLE_LABELS[u.role]}</Badge>{" "}
                        <Badge tone={u.status === "ACTIVE" ? "success" : u.status === "DISABLED" ? "danger" : "warning"}>{USER_STATUS_LABELS[u.status]}</Badge>
                      </td>
                      <td className={`${tableCls.td} text-xs`}>
                        <span className="block">{u.mfaEnabled ? "MFA açık" : <span className="text-muted">MFA kapalı</span>}</span>
                        <span className="block text-muted">Son giriş: {fmtDateTime(u.lastLoginAt)}</span>
                        <span className="block text-muted">Açık oturum: {sCount}</span>
                        {sCount && u.id !== actor.id ? (
                          <form action={revokeSessionsAction}>
                            <input type="hidden" name="id" value={u.id} />
                            <button className="text-accent-ink hover:underline">Oturumları sonlandır</button>
                          </form>
                        ) : null}
                      </td>
                      <td className={`${tableCls.td} tabular`}>{assigned.find((a) => a.assigneeId === u.id)?._count._all ?? 0}</td>
                      <td className={tableCls.td}>
                        <UserRow id={u.id} role={u.role} status={u.status} roles={roleOpts} canRoles={canRoles && (actor.role === "SUPER_ADMIN" || u.role !== "SUPER_ADMIN")} self={u.id === actor.id} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
        <Card title="Rol izin matrisi">
          {canRoles ? (
            <PermissionMatrix
              roles={ROLES.map((r) => ({ value: r, label: ROLE_LABELS[r] }))}
              perms={ALL_PERMISSIONS.map((p) => ({ key: p, label: PERMISSIONS[p], locked: LOCKED_PERMISSIONS.includes(p) }))}
              matrix={matrix}
              defaults={defaults}
            />
          ) : (
            <p className="text-sm text-muted">İzin matrisini yalnız süper yönetici değiştirebilir.</p>
          )}
        </Card>
      </div>
    </>
  );
}
