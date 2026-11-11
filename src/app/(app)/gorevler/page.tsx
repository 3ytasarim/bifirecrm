import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireActor } from "@/lib/rbac/guard";
import { taskScope } from "@/lib/rbac/scope";
import { PRIORITY_LABELS, TASK_STATUS_LABELS } from "@/lib/labels";
import { code, dateToIstanbulLocal, fmtDateTime, fmtRelative, startOfTodayIstanbul } from "@/lib/format";
import { activeUsers, hrefWith, pageParam, PAGE_SIZE, userOptions } from "@/lib/queries";
import { Badge, Card, EmptyState, PageHeader, Pagination } from "@/components/ui/primitives";
import { buttonClass, inputClass } from "@/components/ui/styles";
import { TaskForm } from "@/components/record/record-forms";
import { changeTaskStatus } from "../_record/actions";

export const metadata = { title: "Görevlerim" };

type SP = { durum?: string; sorumlu?: string; q?: string; id?: string; sayfa?: string };
const opts = (l: Record<string, string>) => Object.entries(l).map(([value, label]) => ({ value, label }));

export default async function TasksPage({ searchParams }: { searchParams: Promise<SP> }) {
  const actor = await requireActor();
  const sp = await searchParams;
  const page = pageParam(sp.sayfa);
  const now = new Date();
  const today = startOfTodayIstanbul(now);
  const canAll = actor.perms.has("tasks.view_all");
  const assignee = canAll && sp.sorumlu ? (sp.sorumlu === "tum" ? undefined : sp.sorumlu === "yok" ? null : sp.sorumlu) : actor.id;
  const durum = sp.durum ?? "acik";
  const statusWhere: Prisma.TaskWhereInput =
    durum === "geciken"
      ? { status: { in: ["OPEN", "IN_PROGRESS"] }, dueAt: { lt: now } }
      : durum === "bugun"
        ? { status: { in: ["OPEN", "IN_PROGRESS"] }, dueAt: { gte: today, lt: new Date(today.getTime() + 86400_000) } }
        : durum === "tamam"
          ? { status: { in: ["DONE", "CANCELLED"] } }
          : { status: { in: ["OPEN", "IN_PROGRESS"] } };
  const where: Prisma.TaskWhereInput = {
    AND: [
      taskScope(actor),
      statusWhere,
      assignee === undefined ? {} : { assigneeId: assignee },
      sp.q ? { title: { contains: sp.q, mode: "insensitive" } } : {},
    ],
  };
  const [rows, total, users, editing] = await Promise.all([
    prisma.task.findMany({
      where,
      orderBy: durum === "tamam" ? [{ completedAt: "desc" }] : [{ dueAt: { sort: "asc", nulls: "last" } }, { priority: "desc" }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: {
        assignee: { select: { name: true } },
        contact: { select: { id: true, fullName: true } },
        opportunity: { select: { id: true, number: true } },
        project: { select: { id: true, number: true } },
      },
    }),
    prisma.task.count({ where }),
    activeUsers(),
    sp.id && /^[0-9a-f-]{36}$/i.test(sp.id) ? prisma.task.findFirst({ where: { id: sp.id, ...taskScope(actor) } }) : null,
  ]);
  const base = "/gorevler";
  const userOpts = await userOptions();

  return (
    <>
      <PageHeader title={canAll && assignee !== actor.id ? "Görevler" : "Görevlerim"} description="Açık, geciken ve tamamlanan görevler. Hatırlatma ve gecikme bildirimleri bildirim merkezine düşer." />
      <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
        <div>
          <div className="mb-4 flex flex-wrap gap-2">
            {(
              [
                ["acik", "Açık"],
                ["bugun", "Bugün"],
                ["geciken", "Geciken"],
                ["tamam", "Tamamlanan"],
              ] as const
            ).map(([k, l]) => (
              <Link key={k} href={hrefWith(base, sp, { durum: k, sayfa: undefined, id: undefined })} className={`rounded-full border px-3 py-1.5 text-sm ${durum === k ? "border-accent bg-accent-soft text-accent-ink" : "border-line bg-surface text-muted hover:text-fg"}`}>
                {l}
              </Link>
            ))}
          </div>
          <Card padded={false}>
            <form className="flex flex-wrap gap-2 border-b border-line p-4" role="search">
              <input type="hidden" name="durum" value={durum} />
              <input name="q" defaultValue={sp.q} placeholder="Görev ara" className={`${inputClass()} max-w-xs`} aria-label="Görev ara" />
              {canAll ? (
                <select name="sorumlu" defaultValue={sp.sorumlu ?? ""} className={`${inputClass()} max-w-[220px]`} aria-label="Sorumlu">
                  <option value="">Bana atananlar</option>
                  <option value="tum">Tüm ekip</option>
                  <option value="yok">Atanmamış</option>
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
                </select>
              ) : null}
              <button className={buttonClass("secondary")}>Filtrele</button>
            </form>
            {rows.length ? (
              <ul className="divide-y divide-line">
                {rows.map((t) => {
                  const done = t.status === "DONE" || t.status === "CANCELLED";
                  const late = !done && t.dueAt && t.dueAt < now;
                  return (
                    <li key={t.id} className={`flex flex-wrap items-start gap-3 px-5 py-3 ${editing?.id === t.id ? "bg-accent-soft/40" : ""}`}>
                      {actor.perms.has("tasks.manage") ? (
                        <form action={changeTaskStatus} className="pt-0.5">
                          <input type="hidden" name="id" value={t.id} />
                          <input type="hidden" name="status" value={done ? "OPEN" : "DONE"} />
                          <button className={`grid size-6 place-items-center rounded-md border text-xs ${done ? "border-success bg-success text-white" : "border-line-strong hover:border-accent"}`} aria-label={done ? "Yeniden aç" : "Tamamlandı işaretle"}>
                            {done ? "✓" : ""}
                          </button>
                        </form>
                      ) : null}
                      <div className="min-w-0 flex-1">
                        <Link href={hrefWith(base, sp, { id: t.id })} scroll={false} className={`block text-sm hover:underline ${done ? "text-muted line-through" : "font-medium"}`}>
                          {t.title}
                        </Link>
                        <span className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-muted">
                          {t.contact ? (
                            <Link href={`/musteriler/${t.contact.id}`} className="hover:text-accent-ink">
                              {t.contact.fullName}
                            </Link>
                          ) : null}
                          {t.opportunity ? (
                            <Link href={`/firsatlar/${t.opportunity.id}`} className="hover:text-accent-ink">
                              {code.opportunity(t.opportunity.number)}
                            </Link>
                          ) : null}
                          {t.project ? (
                            <Link href={`/projeler/${t.project.id}`} className="hover:text-accent-ink">
                              {code.project(t.project.number)}
                            </Link>
                          ) : null}
                          <span>{t.assignee?.name ?? "Atanmamış"}</span>
                        </span>
                      </div>
                      {t.priority === "HIGH" || t.priority === "URGENT" ? <Badge tone="warning">{PRIORITY_LABELS[t.priority]}</Badge> : null}
                      <Badge tone={done ? "success" : late ? "danger" : "neutral"}>{done ? TASK_STATUS_LABELS[t.status] : late ? `Gecikti · ${fmtRelative(t.dueAt)}` : t.dueAt ? fmtDateTime(t.dueAt) : "Tarihsiz"}</Badge>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <EmptyState title={durum === "geciken" ? "Geciken görev yok" : "Görev yok"} description="Görevler müşteri, fırsat veya proje sayfasından ya da sağdaki formdan eklenir." />
            )}
            <Pagination page={page} total={total} pageCount={Math.ceil(total / PAGE_SIZE)} buildHref={(p) => hrefWith(base, sp, { sayfa: p })} />
          </Card>
        </div>
        {actor.perms.has("tasks.manage") ? (
          <Card title={editing ? "Görevi düzenle" : "Yeni bağımsız görev"} actions={editing ? <Link href={hrefWith(base, sp, { id: undefined })} className="text-xs text-muted hover:text-fg">Kapat</Link> : null} className="h-fit xl:sticky xl:top-24">
            <TaskForm
              key={editing?.id ?? "new"}
              users={userOpts}
              defaultAssignee={actor.id}
              priorities={opts(PRIORITY_LABELS)}
              statuses={opts(TASK_STATUS_LABELS)}
              task={
                editing
                  ? {
                      id: editing.id,
                      title: editing.title,
                      description: editing.description,
                      priority: editing.priority,
                      status: editing.status,
                      dueLocal: dateToIstanbulLocal(editing.dueAt),
                      remindLocal: dateToIstanbulLocal(editing.remindAt),
                      repeatMinutes: editing.repeatMinutes,
                      assigneeId: editing.assigneeId,
                    }
                  : undefined
              }
            />
          </Card>
        ) : null}
      </div>
    </>
  );
}
