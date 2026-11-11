import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireActor } from "@/lib/rbac/guard";
import { contactScope, opportunityScope, projectScope } from "@/lib/rbac/scope";
import { CHANNEL_LABELS, FIREPLACE_LABELS, PROJECT_STAGE_LABELS, SOURCE_LABELS, STAGE_LABELS } from "@/lib/labels";
import { code, fmtDate, fmtDateTime, fmtMoney } from "@/lib/format";
import { formatPhone } from "@/lib/normalize";
import { Badge, Card, DefList, EmptyState, PageHeader, Tabs } from "@/components/ui/primitives";
import { buttonClass } from "@/components/ui/styles";
import { FilesPanel, HistoryPanel, TasksPanel, TimelinePanel } from "@/components/record/panels";
import { archiveContactAction } from "../actions";

const TABS = ["genel", "projeler", "gorusmeler", "gorevler", "dosyalar", "gecmis"] as const;
type Tab = (typeof TABS)[number];

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const c = /^[0-9a-f-]{36}$/i.test(id) ? await prisma.contact.findUnique({ where: { id }, select: { number: true } }) : null;
  return { title: c ? code.contact(c.number) : "Müşteri" };
}

export default async function ContactDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ sekme?: string }> }) {
  const actor = await requireActor();
  const { id } = await params;
  const sekme = ((await searchParams).sekme ?? "genel") as Tab;
  const tab: Tab = TABS.includes(sekme) ? sekme : "genel";
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  const c = await prisma.contact.findFirst({
    where: { id, ...contactScope(actor) },
    include: {
      owner: { select: { name: true } },
      organization: { select: { name: true } },
      channels: { orderBy: { createdAt: "asc" } },
      consentEvents: { orderBy: { occurredAt: "desc" }, take: 20 },
    },
  });
  if (!c) {
    // Birleştirilmiş kayıt → kazanana yönlendir.
    const merged = await prisma.contact.findUnique({ where: { id }, select: { mergedIntoId: true } });
    if (merged?.mergedIntoId) {
      const { redirect } = await import("next/navigation");
      redirect(`/musteriler/${merged.mergedIntoId}`);
    }
    notFound();
  }

  const [opps, projects, counts] = await Promise.all([
    prisma.opportunity.findMany({
      where: { contactId: id, ...opportunityScope(actor) },
      orderBy: { createdAt: "desc" },
      select: { id: true, number: true, title: true, stage: true, source: true, estimatedAmount: true, currency: true, createdAt: true, owner: { select: { name: true } } },
    }),
    prisma.project.findMany({
      where: { contactId: id, ...projectScope(actor) },
      orderBy: { createdAt: "desc" },
      select: { id: true, number: true, name: true, stage: true, fireplaceType: true, siteDistrict: true, plannedInstallDate: true, datesApprovedAt: true },
    }),
    Promise.all([
      prisma.task.count({ where: { contactId: id, deletedAt: null, status: { in: ["OPEN", "IN_PROGRESS"] } } }),
      prisma.attachment.count({ where: { contactId: id, deletedAt: null } }),
    ]),
  ]);

  const href = (t: Tab) => `/musteriler/${id}${t === "genel" ? "" : `?sekme=${t}`}`;
  const record = { kind: "contact" as const, id };

  return (
    <>
      <PageHeader
        back={{ href: "/musteriler", label: "Müşteriler" }}
        title={c.fullName}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <span className="tabular">{code.contact(c.number)}</span>
            {c.organization ? <span>· {c.organization.name}</span> : null}
            <Badge>{SOURCE_LABELS[c.source]}</Badge>
            {c.tags.map((t) => (
              <Badge key={t} tone="accent">
                {t}
              </Badge>
            ))}
          </span>
        }
        actions={
          <>
            {actor.perms.has("opportunities.create") ? (
              <Link href={`/firsatlar/yeni?musteri=${id}`} className={buttonClass("secondary")}>
                + Yeni fırsat
              </Link>
            ) : null}
            {actor.perms.has("contacts.edit") ? (
              <Link href={`/musteriler/${id}/duzenle`} className={buttonClass()}>
                Düzenle
              </Link>
            ) : null}
          </>
        }
      />
      <Tabs
        active={tab}
        tabs={[
          { key: "genel", label: "Genel", href: href("genel") },
          { key: "projeler", label: "Projeler", href: href("projeler"), count: projects.length },
          { key: "gorusmeler", label: "Görüşmeler", href: href("gorusmeler") },
          { key: "gorevler", label: "Görevler", href: href("gorevler"), count: counts[0] },
          { key: "dosyalar", label: "Dosyalar", href: href("dosyalar"), count: counts[1] },
          { key: "gecmis", label: "Geçmiş", href: href("gecmis") },
        ]}
      />

      {tab === "genel" ? (
        <div className="grid gap-6 xl:grid-cols-3">
          <div className="space-y-6 xl:col-span-2">
            <Card title="İletişim bilgileri">
              <DefList
                items={[
                  { label: "Telefon", value: c.primaryPhone ? <a className="text-accent-ink hover:underline" href={`tel:${c.primaryPhone}`}>{formatPhone(c.primaryPhone)}</a> : null },
                  { label: "E-posta", value: c.primaryEmail ? <a className="text-accent-ink hover:underline" href={`mailto:${c.primaryEmail}`}>{c.primaryEmail}</a> : null },
                  { label: "Tercih ettiği kanal", value: CHANNEL_LABELS[c.preferredChannel] },
                  { label: "Sorumlu", value: c.owner?.name },
                  { label: "İl / İlçe", value: [c.city, c.district].filter(Boolean).join(" / ") },
                  { label: "Adres", value: c.address },
                  { label: "Unvan", value: c.title },
                  { label: "Kayıt tarihi", value: fmtDateTime(c.createdAt) },
                ]}
              />
              {c.channels.length > 2 ? (
                <div className="mt-4 border-t border-line pt-3 text-xs text-muted">
                  Diğer kayıtlı numara/e-postalar:{" "}
                  {c.channels
                    .filter((ch) => !ch.isPrimary)
                    .map((ch) => (ch.type === "EMAIL" ? ch.normalized : formatPhone(ch.normalized)))
                    .join(", ")}
                </div>
              ) : null}
              {c.notes ? <p className="mt-4 whitespace-pre-wrap border-t border-line pt-3 text-sm">{c.notes}</p> : null}
            </Card>
            <Card title="Satış fırsatları" padded={false}>
              {opps.length ? (
                <ul className="divide-y divide-line">
                  {opps.map((o) => (
                    <li key={o.id}>
                      <Link href={`/firsatlar/${o.id}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3 hover:bg-surface-2/50">
                        <span className="w-24 text-xs tabular text-muted">{code.opportunity(o.number)}</span>
                        <span className="min-w-0 flex-1 truncate text-sm font-medium">{o.title}</span>
                        <Badge tone={o.stage === "WON" ? "success" : o.stage === "LOST" ? "danger" : "info"}>{STAGE_LABELS[o.stage]}</Badge>
                        <span className="w-28 text-right text-sm tabular">{o.estimatedAmount ? fmtMoney(o.estimatedAmount, o.currency) : "—"}</span>
                        <span className="w-24 text-right text-xs text-muted">{fmtDate(o.createdAt)}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState title="Fırsat yok" description="Bu müşteriye ait satış fırsatı bulunmuyor." />
              )}
            </Card>
          </div>
          <Card title="KVKK ve izinler">
            <DefList
              items={[
                { label: "Aydınlatma iletildi", value: c.kvkkNoticeAt ? fmtDateTime(c.kvkkNoticeAt) : <span className="text-warning">Kayıt yok</span> },
                { label: "Pazarlama izni", value: c.marketingConsent ? `Var (${fmtDateTime(c.marketingConsentAt)})` : "Yok" },
              ]}
            />
            {c.consentEvents.length ? (
              <ul className="mt-4 space-y-2 border-t border-line pt-3 text-xs">
                {c.consentEvents.map((e) => (
                  <li key={e.id} className="flex justify-between gap-2">
                    <span>
                      {e.type === "KVKK_NOTICE" ? "Aydınlatma" : "Pazarlama izni"} · {e.action === "WITHDRAWN" ? "geri alındı" : e.action === "GRANTED" ? "verildi" : "iletildi"}
                      <span className="text-muted"> ({e.source})</span>
                    </span>
                    <span className="tabular text-muted">{fmtDate(e.occurredAt)}</span>
                  </li>
                ))}
              </ul>
            ) : null}
            {actor.perms.has("contacts.delete") ? (
              <form action={archiveContactAction} className="mt-6 border-t border-line pt-4">
                <input type="hidden" name="id" value={id} />
                <button className="text-sm text-danger hover:underline">Müşteriyi arşivle</button>
                <p className="mt-1 text-xs text-muted">Kayıt silinmez; ilişkiler ve geçmiş korunur, listeden kalkar.</p>
              </form>
            ) : null}
          </Card>
        </div>
      ) : null}

      {tab === "projeler" ? (
        <Card padded={false} title="Projeler">
          {projects.length ? (
            <ul className="divide-y divide-line">
              {projects.map((p) => (
                <li key={p.id}>
                  <Link href={`/projeler/${p.id}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3 hover:bg-surface-2/50">
                    <span className="w-24 text-xs tabular text-muted">{code.project(p.number)}</span>
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">{p.name}</span>
                    {p.fireplaceType ? <Badge>{FIREPLACE_LABELS[p.fireplaceType]}</Badge> : null}
                    <Badge tone="info">{PROJECT_STAGE_LABELS[p.stage]}</Badge>
                    <span className="text-xs text-muted">
                      Montaj: {fmtDate(p.plannedInstallDate)} {p.plannedInstallDate ? (p.datesApprovedAt ? "(onaylı)" : "(onay bekliyor)") : ""}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="Proje yok" description="Kazanılan fırsattan proje açıldığında burada görünür." />
          )}
        </Card>
      ) : null}
      {tab === "gorusmeler" ? <TimelinePanel actor={actor} record={record} /> : null}
      {tab === "gorevler" ? <TasksPanel actor={actor} record={record} path={href("gorevler")} /> : null}
      {tab === "dosyalar" ? <FilesPanel actor={actor} record={record} /> : null}
      {tab === "gecmis" ? <HistoryPanel entityType={["contact"]} entityIds={[id]} /> : null}
    </>
  );
}
