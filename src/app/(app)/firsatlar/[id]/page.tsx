import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireActor } from "@/lib/rbac/guard";
import { opportunityScope, projectScope } from "@/lib/rbac/scope";
import { CHIMNEY_LABELS, FIREPLACE_LABELS, GLASS_LABELS, LOST_REASONS, PROJECT_STAGE_LABELS, SOURCE_LABELS, STAGE_LABELS, STAGE_ORDER } from "@/lib/labels";
import { code, dateOnlyValue, dateToIstanbulLocal, fmtDate, fmtDateTime, fmtMoney } from "@/lib/format";
import { formatPhone } from "@/lib/normalize";
import { userOptions } from "@/lib/queries";
import { Badge, Card, DefList, EmptyState, PageHeader, Tabs } from "@/components/ui/primitives";
import { FilesPanel, HistoryPanel, TasksPanel, TimelinePanel } from "@/components/record/panels";
import { OpportunityForm, ProjectCreateForm, StageForm } from "../forms";
import { archiveOpportunityAction } from "../actions";

const TABS = ["genel", "gorusmeler", "gorevler", "dosyalar", "projeler", "gecmis"] as const;
type Tab = (typeof TABS)[number];
const opts = (l: Record<string, string>) => Object.entries(l).map(([value, label]) => ({ value, label }));

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const o = /^[0-9a-f-]{36}$/i.test(id) ? await prisma.opportunity.findUnique({ where: { id }, select: { number: true } }) : null;
  return { title: o ? code.opportunity(o.number) : "Fırsat" };
}

export default async function OpportunityDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ sekme?: string }> }) {
  const actor = await requireActor();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const s = ((await searchParams).sekme ?? "genel") as Tab;
  const tab: Tab = TABS.includes(s) ? s : "genel";

  const o = await prisma.opportunity.findFirst({
    where: { id, ...opportunityScope(actor) },
    include: {
      contact: { select: { id: true, number: true, fullName: true, primaryPhone: true, primaryEmail: true } },
      owner: { select: { name: true } },
      stageHistory: { orderBy: { changedAt: "desc" }, take: 30 },
    },
  });
  if (!o) notFound();
  const [projects, users, openTasks, files] = await Promise.all([
    prisma.project.findMany({ where: { opportunityId: id, ...projectScope(actor) }, select: { id: true, number: true, name: true, stage: true } }),
    userOptions(),
    prisma.task.count({ where: { opportunityId: id, deletedAt: null, status: { in: ["OPEN", "IN_PROGRESS"] } } }),
    prisma.attachment.count({ where: { opportunityId: id, deletedAt: null } }),
  ]);
  const historyUsers = await prisma.user.findMany({ where: { id: { in: o.stageHistory.map((h) => h.changedById).filter(Boolean) as string[] } }, select: { id: true, name: true } });
  const href = (t: Tab) => `/firsatlar/${id}${t === "genel" ? "" : `?sekme=${t}`}`;
  const record = { kind: "opportunity" as const, id };
  const canEdit = actor.perms.has("opportunities.edit");

  return (
    <>
      <PageHeader
        back={{ href: "/firsatlar", label: "Satış Fırsatları" }}
        title={o.title}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <span className="tabular">{code.opportunity(o.number)}</span>·
            <Link href={`/musteriler/${o.contact.id}`} className="text-accent-ink hover:underline">
              {o.contact.fullName}
            </Link>
            <Badge tone={o.stage === "WON" ? "success" : o.stage === "LOST" ? "danger" : "info"}>{STAGE_LABELS[o.stage]}</Badge>
            <Badge>{SOURCE_LABELS[o.source]}</Badge>
          </span>
        }
      />
      <Tabs
        active={tab}
        tabs={[
          { key: "genel", label: "Genel", href: href("genel") },
          { key: "gorusmeler", label: "Görüşmeler", href: href("gorusmeler") },
          { key: "gorevler", label: "Görevler", href: href("gorevler"), count: openTasks },
          { key: "dosyalar", label: "Dosyalar", href: href("dosyalar"), count: files },
          { key: "projeler", label: "Projeler", href: href("projeler"), count: projects.length },
          { key: "gecmis", label: "Geçmiş", href: href("gecmis") },
        ]}
      />

      {tab === "genel" ? (
        <div className="grid gap-6 xl:grid-cols-3">
          <div className="space-y-6 xl:col-span-2">
            {canEdit ? (
              <Card title="Fırsat bilgileri">
                <OpportunityForm
                  d={{
                    id,
                    contactId: o.contactId,
                    title: o.title,
                    source: o.source,
                    ownerId: o.ownerId,
                    fireplaceType: o.fireplaceType,
                    productCategory: o.productCategory,
                    productModel: o.productModel,
                    city: o.city,
                    district: o.district,
                    message: o.message,
                    estimatedAmount: o.estimatedAmount?.toString() ?? null,
                    currency: o.currency,
                    expectedCloseDate: dateOnlyValue(o.expectedCloseDate),
                    nextActionAt: dateToIstanbulLocal(o.nextActionAt),
                    nextActionNote: o.nextActionNote,
                  }}
                  sources={opts(SOURCE_LABELS)}
                  types={opts(FIREPLACE_LABELS)}
                  users={users}
                  canAssign={actor.perms.has("opportunities.assign")}
                />
              </Card>
            ) : (
              <Card title="Fırsat bilgileri">
                <DefList
                  items={[
                    { label: "Sorumlu", value: o.owner?.name },
                    { label: "Şömine türü", value: o.fireplaceType ? FIREPLACE_LABELS[o.fireplaceType] : null },
                    { label: "Kategori / model", value: [o.productCategory, o.productModel].filter(Boolean).join(" / ") },
                    { label: "Tahmini tutar", value: o.estimatedAmount ? fmtMoney(o.estimatedAmount, o.currency) : null },
                    { label: "Konum", value: [o.district, o.city].filter(Boolean).join(", ") },
                    { label: "Sonraki aksiyon", value: o.nextActionAt ? `${fmtDateTime(o.nextActionAt)} ${o.nextActionNote ?? ""}` : null },
                    { label: "Açıklama", value: o.message },
                  ]}
                />
              </Card>
            )}
          </div>
          <div className="space-y-6">
            <Card title="Aşama">
              {canEdit ? <StageForm id={id} stage={o.stage} stages={STAGE_ORDER.map((s) => ({ value: s, label: STAGE_LABELS[s] }))} lostReasons={LOST_REASONS} /> : <Badge tone="info">{STAGE_LABELS[o.stage]}</Badge>}
              {o.stage === "LOST" && o.lostReason ? (
                <p className="mt-3 rounded-lg bg-danger-soft p-3 text-sm text-danger">
                  Kayıp nedeni: {o.lostReason}
                  {o.lostNote ? ` — ${o.lostNote}` : ""}
                </p>
              ) : null}
              <ol className="mt-4 space-y-2 border-t border-line pt-3 text-xs">
                {o.stageHistory.map((h) => (
                  <li key={h.id} className="flex justify-between gap-2">
                    <span>
                      {h.fromStage ? `${STAGE_LABELS[h.fromStage]} → ` : ""}
                      <span className="font-medium">{STAGE_LABELS[h.toStage]}</span>
                      <span className="text-muted"> · {historyUsers.find((u) => u.id === h.changedById)?.name ?? "Sistem"}</span>
                    </span>
                    <span className="shrink-0 tabular text-muted">{fmtDate(h.changedAt)}</span>
                  </li>
                ))}
              </ol>
            </Card>
            <Card title="Müşteri">
              <DefList
                items={[
                  { label: "Ad", value: <Link className="text-accent-ink hover:underline" href={`/musteriler/${o.contact.id}`}>{o.contact.fullName}</Link> },
                  { label: "Telefon", value: o.contact.primaryPhone ? <a href={`tel:${o.contact.primaryPhone}`} className="text-accent-ink hover:underline">{formatPhone(o.contact.primaryPhone)}</a> : null },
                  { label: "E-posta", value: o.contact.primaryEmail },
                  { label: "Son temas", value: fmtDateTime(o.lastContactAt) },
                ]}
              />
            </Card>
            {actor.perms.has("opportunities.delete") ? (
              <form action={archiveOpportunityAction}>
                <input type="hidden" name="id" value={id} />
                <button className="text-sm text-danger hover:underline">Fırsatı arşivle</button>
              </form>
            ) : null}
          </div>
        </div>
      ) : null}

      {tab === "projeler" ? (
        <div className="space-y-6">
          <Card padded={false} title="Bağlı projeler">
            {projects.length ? (
              <ul className="divide-y divide-line">
                {projects.map((p) => (
                  <li key={p.id}>
                    <Link href={`/projeler/${p.id}`} className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-surface-2/50">
                      <span className="text-sm font-medium">
                        <span className="mr-3 text-xs tabular text-muted">{code.project(p.number)}</span>
                        {p.name}
                      </span>
                      <Badge tone="info">{PROJECT_STAGE_LABELS[p.stage]}</Badge>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState title="Bağlı proje yok" description={o.stage === "WON" ? "Aşağıdan operasyon projesini açın." : "Proje, fırsat “Kazanıldı” aşamasına geçince açılabilir."} />
            )}
          </Card>
          {o.stage === "WON" && actor.perms.has("projects.create") ? (
            <Card title="Kazanılan fırsattan proje aç">
              <ProjectCreateForm opportunityId={id} defaultName={`${o.contact.fullName} — ${o.productModel ?? o.productCategory ?? "Şömine"}`} types={opts(FIREPLACE_LABELS)} chimney={opts(CHIMNEY_LABELS)} glass={opts(GLASS_LABELS)} users={users} />
            </Card>
          ) : null}
        </div>
      ) : null}
      {tab === "gorusmeler" ? <TimelinePanel actor={actor} record={record} /> : null}
      {tab === "gorevler" ? <TasksPanel actor={actor} record={record} path={href("gorevler")} /> : null}
      {tab === "dosyalar" ? <FilesPanel actor={actor} record={record} /> : null}
      {tab === "gecmis" ? <HistoryPanel entityType={["opportunity"]} entityIds={[id]} /> : null}
    </>
  );
}
