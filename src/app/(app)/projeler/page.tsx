import Link from "next/link";
import type { FireplaceType, Prisma, ProjectStage } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireActor } from "@/lib/rbac/guard";
import { projectScope } from "@/lib/rbac/scope";
import { contactSearchWhere } from "@/lib/search";
import { ACTIVE_PROJECT_STAGES, FIREPLACE_LABELS, PROJECT_STAGE_LABELS, PROJECT_STAGE_ORDER } from "@/lib/labels";
import { code, fmtDate } from "@/lib/format";
import { activeUsers, hrefWith, pageParam, PAGE_SIZE } from "@/lib/queries";
import { Badge, Card, EmptyState, PageHeader, Pagination, tableCls } from "@/components/ui/primitives";
import { buttonClass, inputClass } from "@/components/ui/styles";

export const metadata = { title: "Projeler" };

type SP = { q?: string; asama?: string; durum?: string; teknik?: string; tur?: string; sayfa?: string };

export default async function ProjectsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const actor = await requireActor();
  if (!actor.perms.has("projects.view") && !actor.perms.has("projects.view_all")) {
    const { redirect } = await import("next/navigation");
    redirect("/yetkisiz");
  }
  const sp = await searchParams;
  const page = pageParam(sp.sayfa);
  const stage = sp.asama && sp.asama in PROJECT_STAGE_LABELS ? (sp.asama as ProjectStage) : undefined;
  const type = sp.tur && sp.tur in FIREPLACE_LABELS ? (sp.tur as FireplaceType) : undefined;
  const where: Prisma.ProjectWhereInput = {
    AND: [
      projectScope(actor),
      sp.q ? { OR: [{ name: { contains: sp.q, mode: "insensitive" } }, { contact: contactSearchWhere(sp.q) }, ...(/^p-?0*\d+$/i.test(sp.q) ? [{ number: Number(sp.q.replace(/\D/g, "")) }] : [])] } : {},
      stage ? { stage } : sp.durum === "aktif" ? { stage: { in: ACTIVE_PROJECT_STAGES } } : sp.durum === "kapali" ? { stage: { in: ["COMPLETED", "CANCELLED"] } } : {},
      type ? { fireplaceType: type } : {},
      sp.teknik && /^[0-9a-f-]{36}$/.test(sp.teknik) ? { OR: [{ technicalUserId: sp.teknik }, { installationUserId: sp.teknik }] } : {},
    ],
  };
  const [rows, total, users, byStage] = await Promise.all([
    prisma.project.findMany({
      where,
      orderBy: [{ plannedInstallDate: { sort: "asc", nulls: "last" } }, { createdAt: "desc" }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: {
        id: true,
        number: true,
        name: true,
        stage: true,
        fireplaceType: true,
        siteDistrict: true,
        plannedShipDate: true,
        plannedInstallDate: true,
        datesApprovedAt: true,
        contact: { select: { fullName: true } },
        technicalUser: { select: { name: true } },
        installationUser: { select: { name: true } },
      },
    }),
    prisma.project.count({ where }),
    activeUsers(),
    prisma.project.groupBy({ by: ["stage"], where: projectScope(actor), _count: { _all: true } }),
  ]);
  const base = "/projeler";

  return (
    <>
      <PageHeader
        title="Projeler / Üretim / Montaj"
        description="Kazanılan fırsatların operasyon takibi. Sevkiyat/montaj tarihleri teknik onaydan önce kesin değildir."
        actions={actor.perms.has("data.export") ? <a href={hrefWith("/api/export/projects", sp, { sayfa: undefined })} className={buttonClass("secondary")}>CSV</a> : null}
      />
      <div className="mb-4 flex flex-wrap gap-1.5">
        <Link href={hrefWith(base, sp, { asama: undefined, durum: undefined, sayfa: undefined })} className={`rounded-full border px-2.5 py-1 text-xs ${!stage && !sp.durum ? "border-accent bg-accent-soft text-accent-ink" : "border-line bg-surface text-muted"}`}>
          Tümü
        </Link>
        <Link href={hrefWith(base, sp, { asama: undefined, durum: "aktif", sayfa: undefined })} className={`rounded-full border px-2.5 py-1 text-xs ${sp.durum === "aktif" && !stage ? "border-accent bg-accent-soft text-accent-ink" : "border-line bg-surface text-muted"}`}>
          Aktif üretim / montaj
        </Link>
        {PROJECT_STAGE_ORDER.map((s) => (
          <Link key={s} href={hrefWith(base, sp, { asama: s, durum: undefined, sayfa: undefined })} className={`rounded-full border px-2.5 py-1 text-xs ${stage === s ? "border-accent bg-accent-soft text-accent-ink" : "border-line bg-surface text-muted hover:text-fg"}`}>
            {PROJECT_STAGE_LABELS[s]} <span className="tabular">({byStage.find((b) => b.stage === s)?._count._all ?? 0})</span>
          </Link>
        ))}
      </div>
      <Card padded={false}>
        <form className="grid gap-2 border-b border-line p-4 sm:grid-cols-[2fr_1fr_1fr_auto]" role="search">
          {stage ? <input type="hidden" name="asama" value={stage} /> : null}
          {sp.durum ? <input type="hidden" name="durum" value={sp.durum} /> : null}
          <input name="q" defaultValue={sp.q} placeholder="Proje, müşteri, P-no" className={inputClass()} aria-label="Proje ara" />
          <select name="teknik" defaultValue={sp.teknik ?? ""} className={inputClass()} aria-label="Teknik/montaj sorumlusu">
            <option value="">Tüm teknik/montaj ekibi</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
          <select name="tur" defaultValue={type ?? ""} className={inputClass()} aria-label="Şömine türü">
            <option value="">Tüm türler</option>
            {Object.entries(FIREPLACE_LABELS).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
          <button className={buttonClass("secondary")}>Filtrele</button>
        </form>
        {rows.length ? (
          <div className={tableCls.wrap}>
            <table className={tableCls.table}>
              <thead>
                <tr>
                  <th className={tableCls.th}>No</th>
                  <th className={tableCls.th}>Proje</th>
                  <th className={tableCls.th}>Aşama</th>
                  <th className={tableCls.th}>Sevkiyat</th>
                  <th className={tableCls.th}>Montaj</th>
                  <th className={tableCls.th}>Teknik / Montaj</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => (
                  <tr key={p.id} className={tableCls.row}>
                    <td className={`${tableCls.td} tabular text-xs text-muted`}>{code.project(p.number)}</td>
                    <td className={tableCls.td}>
                      <Link href={`/projeler/${p.id}`} className="font-medium hover:text-accent-ink hover:underline">
                        {p.name}
                      </Link>
                      <span className="block text-xs text-muted">
                        {p.contact.fullName}
                        {p.fireplaceType ? ` · ${FIREPLACE_LABELS[p.fireplaceType]}` : ""}
                        {p.siteDistrict ? ` · ${p.siteDistrict}` : ""}
                      </span>
                    </td>
                    <td className={tableCls.td}>
                      <Badge tone={p.stage === "COMPLETED" ? "success" : p.stage === "CANCELLED" ? "danger" : p.stage === "ON_HOLD" ? "warning" : "info"}>{PROJECT_STAGE_LABELS[p.stage]}</Badge>
                    </td>
                    <td className={`${tableCls.td} text-xs tabular`}>{fmtDate(p.plannedShipDate)}</td>
                    <td className={`${tableCls.td} text-xs`}>
                      <span className="tabular">{fmtDate(p.plannedInstallDate)}</span>
                      {p.plannedInstallDate || p.plannedShipDate ? (
                        <span className={`block ${p.datesApprovedAt ? "text-success" : "text-warning"}`}>{p.datesApprovedAt ? "Teknik onaylı" : "Onay bekliyor"}</span>
                      ) : null}
                    </td>
                    <td className={`${tableCls.td} text-xs text-muted`}>
                      {p.technicalUser?.name ?? "—"} / {p.installationUser?.name ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState title="Proje yok" description="Fırsat “Kazanıldı” aşamasına geçince fırsat sayfasındaki Projeler sekmesinden operasyon projesi açılır." />
        )}
        <Pagination page={page} total={total} pageCount={Math.ceil(total / PAGE_SIZE)} buildHref={(p) => hrefWith(base, sp, { sayfa: p })} />
      </Card>
    </>
  );
}
