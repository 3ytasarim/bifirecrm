import Link from "next/link";
import { buttonClass } from "@/components/ui/styles";
import { notFound } from "next/navigation";
import { ShieldCheck, TriangleAlert } from "lucide-react";
import { prisma } from "@/lib/db";
import { requireActor } from "@/lib/rbac/guard";
import { projectScope } from "@/lib/rbac/scope";
import { CHIMNEY_LABELS, FIREPLACE_LABELS, GLASS_LABELS, PROJECT_STAGE_LABELS, PROJECT_STAGE_ORDER } from "@/lib/labels";
import { code, dateOnlyValue, dateToIstanbulLocal, fmtDate, fmtDateTime } from "@/lib/format";
import { formatPhone } from "@/lib/normalize";
import { userOptions } from "@/lib/queries";
import { Badge, Card, DefList, PageHeader, Tabs } from "@/components/ui/primitives";
import { FilesPanel, HistoryPanel, TasksPanel, TimelinePanel } from "@/components/record/panels";
import { ApproveDatesForm, ProjectForm, ProjectStageForm } from "../forms";

const TABS = ["genel", "gorusmeler", "gorevler", "dosyalar", "gecmis"] as const;
type Tab = (typeof TABS)[number];
const opts = (l: Record<string, string>) => Object.entries(l).map(([value, label]) => ({ value, label }));

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const p = /^[0-9a-f-]{36}$/i.test(id) ? await prisma.project.findUnique({ where: { id }, select: { number: true } }) : null;
  return { title: p ? code.project(p.number) : "Proje" };
}

export default async function ProjectDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ sekme?: string }> }) {
  const actor = await requireActor();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const s = ((await searchParams).sekme ?? "genel") as Tab;
  const tab: Tab = TABS.includes(s) ? s : "genel";
  const p = await prisma.project.findFirst({
    where: { id, ...projectScope(actor) },
    include: {
      contact: { select: { id: true, fullName: true, primaryPhone: true } },
      opportunity: { select: { id: true, number: true, title: true } },
      stageHistory: { orderBy: { changedAt: "desc" }, take: 30 },
    },
  });
  if (!p) notFound();
  const [users, openTasks, files, approver] = await Promise.all([
    userOptions(),
    prisma.task.count({ where: { projectId: id, deletedAt: null, status: { in: ["OPEN", "IN_PROGRESS"] } } }),
    prisma.attachment.count({ where: { projectId: id, deletedAt: null } }),
    p.datesApprovedById ? prisma.user.findUnique({ where: { id: p.datesApprovedById }, select: { name: true } }) : null,
  ]);
  const href = (t: Tab) => `/projeler/${id}${t === "genel" ? "" : `?sekme=${t}`}`;
  const record = { kind: "project" as const, id };
  const canEdit = actor.perms.has("projects.edit");
  const hasDates = !!(p.plannedShipDate || p.plannedInstallDate);

  return (
    <>
      <PageHeader
        back={{ href: "/projeler", label: "Projeler" }}
        title={p.name}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <span className="tabular">{code.project(p.number)}</span>·
            <Link href={`/musteriler/${p.contact.id}`} className="text-accent-ink hover:underline">
              {p.contact.fullName}
            </Link>
            {p.opportunity ? (
              <>
                ·
                <Link href={`/firsatlar/${p.opportunity.id}`} className="text-accent-ink hover:underline">
                  {code.opportunity(p.opportunity.number)}
                </Link>
              </>
            ) : null}
            <Badge tone="info">{PROJECT_STAGE_LABELS[p.stage]}</Badge>
          </span>
        }
        actions={
          actor.perms.has("calendar.manage") ? (
            <Link href={`/takvim/yeni?proje=${id}&tur=INSTALLATION`} className={buttonClass("secondary")}>
              Montaj / randevu planla
            </Link>
          ) : null
        }
      />
      <Tabs
        active={tab}
        tabs={[
          { key: "genel", label: "Genel", href: href("genel") },
          { key: "gorusmeler", label: "Görüşmeler", href: href("gorusmeler") },
          { key: "gorevler", label: "Görevler", href: href("gorevler"), count: openTasks },
          { key: "dosyalar", label: "Dosyalar", href: href("dosyalar"), count: files },
          { key: "gecmis", label: "Geçmiş", href: href("gecmis") },
        ]}
      />
      {tab === "genel" ? (
        <div className="grid gap-6 xl:grid-cols-3">
          <Card title="Teknik bilgiler ve planlama" className="xl:col-span-2">
            <ProjectForm
              readOnly={!canEdit}
              d={{
                id,
                name: p.name,
                fireplaceType: p.fireplaceType,
                productCategory: p.productCategory,
                productModel: p.productModel,
                siteAddress: p.siteAddress,
                siteCity: p.siteCity,
                siteDistrict: p.siteDistrict,
                wallWidthCm: p.wallWidthCm?.toString() ?? null,
                ceilingHeightCm: p.ceilingHeightCm?.toString() ?? null,
                chimneyStatus: p.chimneyStatus,
                glassOrientation: p.glassOrientation,
                cladding: p.cladding,
                technicalNotes: p.technicalNotes,
                surveyDate: dateToIstanbulLocal(p.surveyDate),
                ownerId: p.ownerId,
                technicalUserId: p.technicalUserId,
                installationUserId: p.installationUserId,
                plannedShipDate: dateOnlyValue(p.plannedShipDate),
                plannedInstallDate: dateOnlyValue(p.plannedInstallDate),
                holdReason: p.holdReason,
              }}
              types={opts(FIREPLACE_LABELS)}
              chimney={opts(CHIMNEY_LABELS)}
              glass={opts(GLASS_LABELS)}
              users={users}
            />
          </Card>
          <div className="space-y-6">
            <Card title="Teslim tarihleri">
              {hasDates ? (
                p.datesApprovedAt ? (
                  <p className="flex items-start gap-2 rounded-lg bg-success-soft p-3 text-sm text-success">
                    <ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden />
                    <span>
                      Teknik onaylı · {approver?.name ?? "—"} · {fmtDateTime(p.datesApprovedAt)}
                    </span>
                  </p>
                ) : (
                  <p className="flex items-start gap-2 rounded-lg bg-warning-soft p-3 text-sm text-warning">
                    <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
                    <span>Tarihler teknik onay bekliyor. Onaysız tarih müşteriye kesin tarih olarak iletilmemeli.</span>
                  </p>
                )
              ) : (
                <p className="text-sm text-muted">Planlanan sevkiyat/montaj tarihi girilmedi.</p>
              )}
              <DefList
                items={[
                  { label: "Sevkiyat (plan)", value: fmtDate(p.plannedShipDate) },
                  { label: "Montaj (plan)", value: fmtDate(p.plannedInstallDate) },
                  { label: "Montaj yapıldı", value: p.installedAt ? fmtDateTime(p.installedAt) : null },
                  { label: "Tamamlandı", value: p.completedAt ? fmtDateTime(p.completedAt) : null },
                ]}
              />
              {hasDates && !p.datesApprovedAt && actor.perms.has("projects.approve_dates") ? (
                <div className="mt-4">
                  <ApproveDatesForm id={id} />
                </div>
              ) : null}
              <p className="mt-3 text-xs text-muted">Sistem müşteriye otomatik tarih/fiyat bildirimi göndermez.</p>
            </Card>
            <Card title="Aşama">
              {canEdit ? <ProjectStageForm id={id} stage={p.stage} stages={PROJECT_STAGE_ORDER.map((s) => ({ value: s, label: PROJECT_STAGE_LABELS[s] }))} /> : <Badge tone="info">{PROJECT_STAGE_LABELS[p.stage]}</Badge>}
              <ol className="mt-4 space-y-2 border-t border-line pt-3 text-xs">
                {p.stageHistory.map((h) => (
                  <li key={h.id} className="flex justify-between gap-2">
                    <span>
                      {h.fromStage ? `${PROJECT_STAGE_LABELS[h.fromStage]} → ` : ""}
                      <span className="font-medium">{PROJECT_STAGE_LABELS[h.toStage]}</span>
                      {h.note ? <span className="block text-muted">{h.note}</span> : null}
                    </span>
                    <span className="shrink-0 tabular text-muted">{fmtDate(h.changedAt)}</span>
                  </li>
                ))}
              </ol>
            </Card>
            <Card title="Müşteri">
              <DefList
                items={[
                  { label: "Ad", value: p.contact.fullName },
                  { label: "Telefon", value: p.contact.primaryPhone ? <a href={`tel:${p.contact.primaryPhone}`} className="text-accent-ink hover:underline">{formatPhone(p.contact.primaryPhone)}</a> : null },
                ]}
              />
            </Card>
          </div>
        </div>
      ) : null}
      {tab === "gorusmeler" ? <TimelinePanel actor={actor} record={record} /> : null}
      {tab === "gorevler" ? <TasksPanel actor={actor} record={record} path={href("gorevler")} /> : null}
      {tab === "dosyalar" ? <FilesPanel actor={actor} record={record} /> : null}
      {tab === "gecmis" ? <HistoryPanel entityType={["project"]} entityIds={[id]} /> : null}
    </>
  );
}
