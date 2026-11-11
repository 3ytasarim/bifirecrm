import Link from "next/link";
import { FileText, Image as ImageIcon, Pin, Trash2 } from "lucide-react";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { Actor } from "@/lib/rbac/guard";
import { taskScope } from "@/lib/rbac/scope";
import { relationWhere, timeline, type RecordRef } from "@/lib/services/records";
import { ACTIVITY_LABELS, ATTACHMENT_KIND_LABELS, LOGGABLE_ACTIVITIES, PRIORITY_LABELS, TASK_STATUS_LABELS } from "@/lib/labels";
import { dateToIstanbulLocal, fmtDateTime, fmtRelative } from "@/lib/format";
import { signFileToken } from "@/lib/storage";
import { ACCEPT_ATTR } from "@/lib/storage/files";
import { env } from "@/lib/env";
import { userOptions } from "@/lib/queries";
import { Badge, Card, EmptyState, tableCls } from "@/components/ui/primitives";
import { buttonClass } from "@/components/ui/styles";
import { changeTaskStatus, deleteFile, deleteNote, removeTask, toggleNotePin } from "@/app/(app)/_record/actions";
import { TaskForm, TimelineComposer, UploadForm } from "./record-forms";

const opts = <T extends string>(labels: Record<T, string>, only?: T[]) =>
  (only ?? (Object.keys(labels) as T[])).map((value) => ({ value, label: labels[value] }));

export async function TimelinePanel({ actor, record }: { actor: Actor; record: RecordRef }) {
  const { pinned, items } = await timeline(record);
  const canWrite = actor.perms.has("notes.write");
  return (
    <div className="space-y-4">
      {canWrite ? <TimelineComposer record={record} activityTypes={opts(ACTIVITY_LABELS, LOGGABLE_ACTIVITIES)} nowLocal={dateToIstanbulLocal(new Date())} /> : null}
      {pinned.map((n) => (
        <div key={n.id} className="rounded-xl border border-accent/30 bg-accent-soft/50 p-4">
          <div className="mb-1 flex items-center justify-between gap-2 text-xs text-muted">
            <span className="inline-flex items-center gap-1 font-medium text-accent-ink">
              <Pin className="size-3.5" aria-hidden /> Sabit not · {n.authorName}
            </span>
            <span>{fmtDateTime(n.createdAt)}</span>
          </div>
          <p className="whitespace-pre-wrap text-sm">{n.body}</p>
          {canWrite ? (
            <form action={toggleNotePin} className="mt-2">
              <input type="hidden" name="id" value={n.id} />
              <button className="text-xs text-muted hover:text-fg">Sabitlemeyi kaldır</button>
            </form>
          ) : null}
        </div>
      ))}
      {items.length ? (
        <ol className="relative space-y-0 border-l border-line pl-5">
          {items.map((i) => (
            <li key={`${i.kind}-${i.id}`} className="relative pb-5">
              <span className={`absolute -left-[26px] top-1 size-3 rounded-full border-2 border-surface ${i.kind === "note" ? "bg-accent" : i.type === "STAGE_CHANGE" ? "bg-info" : i.type === "SYSTEM" ? "bg-line-strong" : "bg-success"}`} aria-hidden />
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 text-xs text-muted">
                <span>
                  <span className="font-medium text-fg">{i.kind === "note" ? "Not" : ACTIVITY_LABELS[i.type]}</span> · {i.actorName}
                  {i.kind === "activity" && i.durationMin ? ` · ${i.durationMin} dk` : ""}
                </span>
                <time dateTime={i.at.toISOString()} title={fmtDateTime(i.at)}>
                  {fmtRelative(i.at)}
                </time>
              </div>
              {i.kind === "activity" && i.subject ? <p className="mt-0.5 text-sm font-medium">{i.subject}</p> : null}
              {i.body ? <p className="mt-0.5 whitespace-pre-wrap text-sm text-fg/90">{i.body}</p> : null}
              {i.kind === "note" && canWrite ? (
                <div className="mt-1 flex gap-3">
                  <form action={toggleNotePin}>
                    <input type="hidden" name="id" value={i.id} />
                    <button className="text-xs text-muted hover:text-fg">Sabitle</button>
                  </form>
                  {i.authorId === actor.id || actor.perms.has("contacts.view_all") ? (
                    <form action={deleteNote}>
                      <input type="hidden" name="id" value={i.id} />
                      <button className="text-xs text-muted hover:text-danger">Sil</button>
                    </form>
                  ) : null}
                </div>
              ) : null}
            </li>
          ))}
        </ol>
      ) : (
        <EmptyState title="Henüz kayıt yok" description="Notlar, görüşmeler, aşama değişimleri ve sistem olayları burada zaman sırasıyla görünür." />
      )}
    </div>
  );
}

export async function TasksPanel({ actor, record, path }: { actor: Actor; record: RecordRef; path: string }) {
  const where: Prisma.TaskWhereInput = { ...taskScope(actor), ...relationWhere(record) };
  const tasks = await prisma.task.findMany({
    where,
    orderBy: [{ status: "asc" }, { dueAt: { sort: "asc", nulls: "last" } }],
    include: { assignee: { select: { name: true } } },
    take: 100,
  });
  const now = new Date();
  const canManage = actor.perms.has("tasks.manage");
  return (
    <div className="space-y-4">
      {canManage ? (
        <Card title="Yeni görev">
          <TaskForm record={record} users={await userOptions()} defaultAssignee={actor.id} priorities={opts(PRIORITY_LABELS)} />
        </Card>
      ) : null}
      <Card padded={false} title="Görevler">
        {tasks.length ? (
          <ul className="divide-y divide-line">
            {tasks.map((t) => {
              const done = t.status === "DONE" || t.status === "CANCELLED";
              const late = !done && t.dueAt && t.dueAt < now;
              return (
                <li key={t.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                  {canManage ? (
                    <form action={changeTaskStatus}>
                      <input type="hidden" name="id" value={t.id} />
                      <input type="hidden" name="path" value={path} />
                      <input type="hidden" name="status" value={done ? "OPEN" : "DONE"} />
                      <button className={`grid size-6 place-items-center rounded-md border ${done ? "border-success bg-success text-white" : "border-line-strong hover:border-accent"}`} aria-label={done ? "Yeniden aç" : "Tamamlandı işaretle"}>
                        {done ? "✓" : ""}
                      </button>
                    </form>
                  ) : null}
                  <Link href={`/gorevler?id=${t.id}`} className="min-w-0 flex-1">
                    <span className={`block text-sm ${done ? "text-muted line-through" : "font-medium"}`}>{t.title}</span>
                    <span className="block text-xs text-muted">{t.assignee?.name ?? "Atanmamış"}</span>
                  </Link>
                  {t.priority === "HIGH" || t.priority === "URGENT" ? <Badge tone="warning">{PRIORITY_LABELS[t.priority]}</Badge> : null}
                  <Badge tone={done ? "success" : late ? "danger" : "neutral"}>{late ? `Gecikti · ${fmtRelative(t.dueAt)}` : t.dueAt ? fmtDateTime(t.dueAt) : TASK_STATUS_LABELS[t.status]}</Badge>
                  {canManage ? (
                    <form action={removeTask}>
                      <input type="hidden" name="id" value={t.id} />
                      <input type="hidden" name="path" value={path} />
                      <button className="grid size-8 place-items-center rounded-lg text-muted hover:bg-danger-soft hover:text-danger" aria-label="Görevi sil">
                        <Trash2 className="size-4" />
                      </button>
                    </form>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : (
          <EmptyState title="Görev yok" />
        )}
      </Card>
    </div>
  );
}

export async function FilesPanel({ actor, record }: { actor: Actor; record: RecordRef }) {
  const files = await prisma.attachment.findMany({ where: { ...relationWhere(record), deletedAt: null }, orderBy: { createdAt: "desc" }, take: 200 });
  const uploaders = await prisma.user.findMany({ where: { id: { in: files.map((f) => f.uploadedById).filter(Boolean) as string[] } }, select: { id: true, name: true } });
  const canDownload = actor.perms.has("files.download");
  const link = (id: string, variant: "file" | "thumb") => {
    const { exp, sig } = signFileToken(id, actor.id, variant);
    return `/api/files/${id}?v=${variant}&exp=${exp}&sig=${sig}`;
  };
  return (
    <div className="space-y-4">
      {actor.perms.has("files.upload") ? (
        <Card title="Dosya yükle">
          <UploadForm record={record} kinds={opts(ATTACHMENT_KIND_LABELS)} accept={ACCEPT_ATTR} maxMb={env().MAX_UPLOAD_MB} />
        </Card>
      ) : null}
      <Card padded={false} title={`Dosyalar (${files.length})`}>
        {files.length ? (
          <div className={tableCls.wrap}>
            <table className={tableCls.table}>
              <thead>
                <tr>
                  <th className={tableCls.th}>Dosya</th>
                  <th className={tableCls.th}>Tür</th>
                  <th className={tableCls.th}>Boyut</th>
                  <th className={tableCls.th}>Yükleyen</th>
                  <th className={tableCls.th}></th>
                </tr>
              </thead>
              <tbody>
                {files.map((f) => (
                  <tr key={f.id} className={tableCls.row}>
                    <td className={tableCls.td}>
                      <div className="flex items-center gap-3">
                        {f.thumbnailKey && canDownload ? (
                          // eslint-disable-next-line @next/next/no-img-element -- imzalı, kullanıcıya özel önizleme (next/image önbelleğine girmemeli)
                          <img src={link(f.id, "thumb")} alt="" className="size-12 rounded-md border border-line object-cover" loading="lazy" />
                        ) : (
                          <span className="grid size-12 place-items-center rounded-md border border-line bg-surface-2 text-muted">
                            {f.mimeType.startsWith("image/") ? <ImageIcon className="size-5" /> : <FileText className="size-5" />}
                          </span>
                        )}
                        <span className="min-w-0">
                          {canDownload ? (
                            <a href={link(f.id, "file")} className="block truncate font-medium text-accent-ink hover:underline">
                              {f.originalName}
                            </a>
                          ) : (
                            <span className="block truncate font-medium">{f.originalName}</span>
                          )}
                          <span className="block text-xs text-muted">
                            {fmtDateTime(f.createdAt)}
                            {f.exifStripped ? " · konum verisi temizlendi" : ""}
                            {f.scanStatus === "NOT_SCANNED" ? " · virüs taraması yapılandırılmadı" : f.scanStatus === "CLEAN" ? " · taramadan geçti" : ""}
                          </span>
                        </span>
                      </div>
                    </td>
                    <td className={tableCls.td}>
                      <Badge>{ATTACHMENT_KIND_LABELS[f.kind]}</Badge>
                    </td>
                    <td className={`${tableCls.td} tabular text-muted`}>{(f.sizeBytes / 1024 / 1024).toFixed(2)} MB</td>
                    <td className={`${tableCls.td} text-muted`}>{uploaders.find((u) => u.id === f.uploadedById)?.name ?? "—"}</td>
                    <td className={`${tableCls.td} text-right`}>
                      {actor.perms.has("files.delete") ? (
                        <form action={deleteFile}>
                          <input type="hidden" name="id" value={f.id} />
                          <button className={buttonClass("ghost", "sm")} aria-label={`${f.originalName} dosyasını sil`}>
                            <Trash2 className="size-4" />
                          </button>
                        </form>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState title="Dosya yok" description="Görseller, çizimler, teklifler, sözleşmeler ve tutanaklar özel depoda saklanır." />
        )}
      </Card>
    </div>
  );
}

export async function HistoryPanel({ entityType, entityIds }: { entityType: string[]; entityIds: string[] }) {
  const rows = await prisma.auditLog.findMany({
    where: { entityType: { in: entityType }, entityId: { in: entityIds } },
    orderBy: { createdAt: "desc" },
    take: 200,
    include: { actor: { select: { name: true } } },
  });
  const { AUDIT_ACTION_LABELS } = await import("@/lib/labels");
  return (
    <Card padded={false} title="Değişiklik geçmişi (denetim kaydı)">
      {rows.length ? (
        <ul className="divide-y divide-line">
          {rows.map((r) => (
            <li key={r.id} className="px-5 py-3 text-sm">
              <div className="flex flex-wrap justify-between gap-2">
                <span>
                  <span className="font-medium">{AUDIT_ACTION_LABELS[r.action] ?? r.action}</span>
                  <span className="text-muted"> · {r.actor?.name ?? "Sistem"}</span>
                </span>
                <span className="text-xs tabular text-muted">{fmtDateTime(r.createdAt)}</span>
              </div>
              {r.summary ? <p className="mt-0.5 text-xs text-muted">{r.summary}</p> : null}
              {r.before || r.after ? (
                <details className="mt-1">
                  <summary className="cursor-pointer text-xs text-accent-ink">Ayrıntı</summary>
                  <pre className="mt-1 max-h-60 overflow-auto rounded-lg bg-surface-2 p-2 text-[11px] leading-relaxed">{JSON.stringify({ önce: r.before, sonra: r.after }, null, 2)}</pre>
                </details>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState title="Kayıtlı değişiklik yok" />
      )}
    </Card>
  );
}
