import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/rbac/guard";
import { AUDIT_ACTION_LABELS } from "@/lib/labels";
import { fmtDateTime, parseDateOnly } from "@/lib/format";
import { activeUsers, hrefWith, pageParam } from "@/lib/queries";
import { Card, EmptyState, PageHeader, Pagination, tableCls } from "@/components/ui/primitives";
import { buttonClass, inputClass } from "@/components/ui/styles";

export const metadata = { title: "Denetim kaydı" };
const SIZE = 50;

type SP = { islem?: string; kullanici?: string; tur?: string; baslangic?: string; bitis?: string; sayfa?: string };

// Dosya indirme (API rotası), sayfa gezintisi değil.
const csvLink = <a href="/api/export/audit" download className={buttonClass("secondary")}>CSV</a>;

export default async function AuditPage({ searchParams }: { searchParams: Promise<SP> }) {
  await requirePermission("audit.view");
  const sp = await searchParams;
  const page = pageParam(sp.sayfa);
  const from = parseDateOnly(sp.baslangic);
  const to = parseDateOnly(sp.bitis);
  const where: Prisma.AuditLogWhereInput = {
    ...(sp.islem ? { action: sp.islem } : {}),
    ...(sp.kullanici && /^[0-9a-f-]{36}$/.test(sp.kullanici) ? { actorId: sp.kullanici } : {}),
    ...(sp.tur ? { entityType: sp.tur } : {}),
    ...(from || to ? { createdAt: { ...(from ? { gte: new Date(from.getTime() - 3 * 3600_000) } : {}), ...(to ? { lt: new Date(to.getTime() + 21 * 3600_000) } : {}) } } : {}),
  };
  const [rows, total, users] = await Promise.all([
    prisma.auditLog.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * SIZE, take: SIZE, include: { actor: { select: { name: true } } } }),
    prisma.auditLog.count({ where }),
    activeUsers(),
  ]);
  return (
    <>
      <PageHeader title="Denetim kaydı" description="Değiştirilemez işlem günlüğü. IP adresleri ham değil, tuzlanmış özet olarak saklanır." back={{ href: "/ayarlar", label: "Ayarlar" }} actions={csvLink} />
      <Card padded={false}>
        <form className="grid gap-2 border-b border-line p-4 sm:grid-cols-2 lg:grid-cols-[repeat(5,1fr)_auto]">
          <select name="islem" defaultValue={sp.islem ?? ""} className={inputClass()} aria-label="İşlem">
            <option value="">Tüm işlemler</option>
            {Object.entries(AUDIT_ACTION_LABELS).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
          <select name="kullanici" defaultValue={sp.kullanici ?? ""} className={inputClass()} aria-label="Kullanıcı">
            <option value="">Tüm kullanıcılar</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
          <select name="tur" defaultValue={sp.tur ?? ""} className={inputClass()} aria-label="Kayıt türü">
            <option value="">Tüm kayıt türleri</option>
            {["user", "contact", "opportunity", "project", "task", "attachment", "lead", "role_permissions", "note"].map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <input type="date" name="baslangic" defaultValue={sp.baslangic} className={inputClass()} aria-label="Başlangıç" />
          <input type="date" name="bitis" defaultValue={sp.bitis} className={inputClass()} aria-label="Bitiş" />
          <button className={buttonClass("secondary")}>Filtrele</button>
        </form>
        {rows.length ? (
          <div className={tableCls.wrap}>
            <table className={tableCls.table}>
              <thead>
                <tr>
                  <th className={tableCls.th}>Zaman</th>
                  <th className={tableCls.th}>Kullanıcı</th>
                  <th className={tableCls.th}>İşlem</th>
                  <th className={tableCls.th}>Kayıt</th>
                  <th className={tableCls.th}>Özet</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className={tableCls.row}>
                    <td className={`${tableCls.td} whitespace-nowrap text-xs tabular text-muted`}>{fmtDateTime(r.createdAt)}</td>
                    <td className={`${tableCls.td} text-sm`}>{r.actor?.name ?? "Sistem / anonim"}</td>
                    <td className={`${tableCls.td} text-sm ${r.action === "login_failed" ? "text-danger" : ""}`}>{AUDIT_ACTION_LABELS[r.action] ?? r.action}</td>
                    <td className={`${tableCls.td} text-xs text-muted`}>
                      {r.entityType}
                      {r.entityId ? <span className="block font-mono text-[10px]">{r.entityId.slice(0, 8)}…</span> : null}
                    </td>
                    <td className={`${tableCls.td} text-xs`}>
                      {r.summary}
                      {r.before || r.after ? (
                        <details>
                          <summary className="cursor-pointer text-accent-ink">Ayrıntı</summary>
                          <pre className="mt-1 max-h-60 max-w-xl overflow-auto rounded bg-surface-2 p-2 text-[11px]">{JSON.stringify({ önce: r.before, sonra: r.after }, null, 2)}</pre>
                        </details>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState title="Kayıt yok" />
        )}
        <Pagination page={page} total={total} pageCount={Math.ceil(total / SIZE)} buildHref={(p) => hrefWith("/ayarlar/denetim", sp, { sayfa: p })} />
      </Card>
    </>
  );
}
