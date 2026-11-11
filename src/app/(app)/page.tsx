import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireActor } from "@/lib/rbac/guard";
import { opportunityScope, projectScope, taskScope } from "@/lib/rbac/scope";
import { ACTIVE_PROJECT_STAGES, PRIORITY_LABELS, PROJECT_STAGE_LABELS, SOURCE_LABELS, STAGE_LABELS } from "@/lib/labels";
import { code, fmtDateTime, fmtMoney, fmtRelative } from "@/lib/format";
import { Badge, Card, EmptyState, PageHeader, Stat } from "@/components/ui/primitives";
import { buttonClass } from "@/components/ui/styles";

export const metadata = { title: "Genel Bakış" };

const DAY = 24 * 3600_000;

export default async function Dashboard() {
  const actor = await requireActor();
  const now = new Date();
  const since7 = new Date(now.getTime() - 7 * DAY);
  const since30 = new Date(now.getTime() - 30 * DAY);
  const oppScope = opportunityScope(actor);
  const tScope = taskScope(actor);
  const isManager = actor.perms.has("opportunities.view_all");

  const [newOpps, bySource, overdueTasks, awaitingQuote, won30, lost30, activeProjects, myTasks, byOwner, recent] = await Promise.all([
    prisma.opportunity.count({ where: { ...oppScope, createdAt: { gte: since7 } } }),
    prisma.opportunity.groupBy({ by: ["source"], where: { ...oppScope, createdAt: { gte: since30 } }, _count: { _all: true } }),
    prisma.task.count({ where: { ...tScope, status: { in: ["OPEN", "IN_PROGRESS"] }, dueAt: { lt: now } } }),
    prisma.opportunity.count({ where: { ...oppScope, stage: { in: ["QUOTATION_PREPARING", "QUOTATION_SENT"] } } }),
    prisma.opportunity.aggregate({ where: { ...oppScope, stage: "WON", wonAt: { gte: since30 } }, _count: { _all: true }, _sum: { estimatedAmount: true } }),
    prisma.opportunity.count({ where: { ...oppScope, stage: "LOST", lostAt: { gte: since30 } } }),
    prisma.project.groupBy({ by: ["stage"], where: { ...projectScope(actor), stage: { in: ACTIVE_PROJECT_STAGES } }, _count: { _all: true } }),
    prisma.task.findMany({
      where: { deletedAt: null, assigneeId: actor.id, status: { in: ["OPEN", "IN_PROGRESS"] } },
      orderBy: [{ dueAt: { sort: "asc", nulls: "last" } }],
      take: 8,
      select: { id: true, title: true, dueAt: true, priority: true, contact: { select: { fullName: true } } },
    }),
    isManager
      ? prisma.opportunity.groupBy({ by: ["ownerId"], where: { ...oppScope, stage: { notIn: ["WON", "LOST"] } }, _count: { _all: true } })
      : Promise.resolve([]),
    prisma.opportunity.findMany({
      where: { ...oppScope, stage: { in: ["NEW", "CONTACT_PENDING"] } },
      orderBy: { createdAt: "desc" },
      take: 6,
      select: { id: true, number: true, title: true, stage: true, source: true, createdAt: true, contact: { select: { fullName: true } }, owner: { select: { name: true } } },
    }),
  ]);

  const owners = byOwner.length
    ? await prisma.user.findMany({ where: { id: { in: byOwner.map((b) => b.ownerId).filter(Boolean) as string[] } }, select: { id: true, name: true } })
    : [];
  const activeTotal = activeProjects.reduce((s, p) => s + p._count._all, 0);
  const sourceTotal = bySource.reduce((s, r) => s + r._count._all, 0);

  return (
    <>
      <PageHeader
        title="Genel Bakış"
        description={`Hoş geldiniz, ${actor.name.split(" ")[0]}. ${isManager ? "Tüm ekip verisi" : "Size bağlı kayıtlar"} gösteriliyor.`}
        actions={
          actor.perms.has("contacts.create") ? (
            <Link href="/talepler/yeni" className={buttonClass("primary")}>
              + Hızlı kayıt
            </Link>
          ) : null
        }
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Stat label="Yeni fırsat (7 gün)" value={newOpps} href="/firsatlar?gorunum=tablo&tarih=7" />
        <Stat label="Geciken görev" value={overdueTasks} tone={overdueTasks ? "danger" : undefined} href="/gorevler?durum=geciken" />
        <Stat label="Teklif aşamasında" value={awaitingQuote} href="/firsatlar?gorunum=tablo&asama=QUOTATION_PREPARING,QUOTATION_SENT" />
        <Stat label="Kazanılan (30 gün)" value={won30._count._all} hint={won30._sum.estimatedAmount ? fmtMoney(won30._sum.estimatedAmount) : undefined} tone="accent" />
        <Stat label="Kaybedilen (30 gün)" value={lost30} />
        <Stat label="Aktif üretim / montaj" value={activeTotal} href="/projeler?durum=aktif" />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <Card title="Görevlerim" className="xl:col-span-1" actions={<Link href="/gorevler" className="text-xs text-accent-ink hover:underline">Tümü</Link>} padded={false}>
          {myTasks.length ? (
            <ul className="divide-y divide-line">
              {myTasks.map((t) => {
                const late = t.dueAt && t.dueAt < now;
                return (
                  <li key={t.id}>
                    <Link href={`/gorevler?id=${t.id}`} className="flex items-start justify-between gap-3 px-5 py-3 hover:bg-surface-2/50">
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium">{t.title}</span>
                        <span className="block truncate text-xs text-muted">{t.contact?.fullName ?? "Bağımsız görev"}</span>
                      </span>
                      <span className="shrink-0 text-right">
                        <span className={`block text-xs tabular ${late ? "font-medium text-danger" : "text-muted"}`}>{t.dueAt ? fmtRelative(t.dueAt) : "Tarihsiz"}</span>
                        {t.priority === "HIGH" || t.priority === "URGENT" ? <Badge tone="warning" className="mt-1">{PRIORITY_LABELS[t.priority]}</Badge> : null}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          ) : (
            <EmptyState title="Açık göreviniz yok" description="Size atanan görevler burada görünür." />
          )}
        </Card>

        <Card title="Dönüş bekleyen yeni talepler" className="xl:col-span-2" actions={<Link href="/firsatlar" className="text-xs text-accent-ink hover:underline">Kanban</Link>} padded={false}>
          {recent.length ? (
            <ul className="divide-y divide-line">
              {recent.map((o) => (
                <li key={o.id}>
                  <Link href={`/firsatlar/${o.id}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3 hover:bg-surface-2/50">
                    <span className="w-24 text-xs tabular text-muted">{code.opportunity(o.number)}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{o.contact.fullName}</span>
                      <span className="block truncate text-xs text-muted">{o.title}</span>
                    </span>
                    <Badge>{SOURCE_LABELS[o.source]}</Badge>
                    <Badge tone={o.stage === "NEW" ? "accent" : "info"}>{STAGE_LABELS[o.stage]}</Badge>
                    <span className="w-32 text-right text-xs text-muted">{o.owner?.name ?? <span className="text-danger">Sorumlu yok</span>}</span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="Bekleyen yeni talep yok" description="Yeni ve iletişim bekleyen fırsatlar burada listelenir." />
          )}
        </Card>

        <Card title="Kaynak kırılımı (30 gün)">
          {bySource.length ? (
            <ul className="space-y-3">
              {bySource
                .sort((a, b) => b._count._all - a._count._all)
                .map((r) => {
                  const pct = Math.round((r._count._all / sourceTotal) * 100);
                  return (
                    <li key={r.source}>
                      <div className="mb-1 flex justify-between text-sm">
                        <span>{SOURCE_LABELS[r.source]}</span>
                        <span className="tabular text-muted">
                          {r._count._all} · %{pct}
                        </span>
                      </div>
                      <div className="h-1.5 rounded-full bg-surface-2" aria-hidden>
                        <div className="h-1.5 rounded-full bg-accent" style={{ width: `${pct}%` }} />
                      </div>
                    </li>
                  );
                })}
            </ul>
          ) : (
            <EmptyState title="Son 30 günde fırsat yok" />
          )}
        </Card>

        <Card title="Aktif projeler (aşama)">
          {activeProjects.length ? (
            <ul className="space-y-2 text-sm">
              {ACTIVE_PROJECT_STAGES.map((s) => {
                const n = activeProjects.find((p) => p.stage === s)?._count._all ?? 0;
                return (
                  <li key={s} className="flex justify-between">
                    <Link href={`/projeler?asama=${s}`} className="hover:underline">
                      {PROJECT_STAGE_LABELS[s]}
                    </Link>
                    <span className="tabular text-muted">{n}</span>
                  </li>
                );
              })}
            </ul>
          ) : (
            <EmptyState title="Üretimde / montajda iş yok" />
          )}
        </Card>

        {isManager ? (
          <Card title="Sorumlu başına açık fırsat">
            {byOwner.length ? (
              <ul className="space-y-2 text-sm">
                {byOwner
                  .sort((a, b) => b._count._all - a._count._all)
                  .map((b) => (
                    <li key={b.ownerId ?? "none"} className="flex justify-between">
                      <Link href={`/firsatlar?gorunum=tablo&sorumlu=${b.ownerId ?? "yok"}`} className={b.ownerId ? "hover:underline" : "text-danger hover:underline"}>
                        {owners.find((o) => o.id === b.ownerId)?.name ?? "Sorumlu atanmamış"}
                      </Link>
                      <span className="tabular text-muted">{b._count._all}</span>
                    </li>
                  ))}
              </ul>
            ) : (
              <EmptyState title="Açık fırsat yok" />
            )}
          </Card>
        ) : null}
      </div>
      <p className="mt-6 text-xs text-muted">Son güncelleme: {fmtDateTime(now)} (Europe/Istanbul)</p>
    </>
  );
}
