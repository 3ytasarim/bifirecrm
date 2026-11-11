import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireActor } from "@/lib/rbac/guard";
import { nowMs } from "@/lib/format";
import { appointmentScope } from "@/lib/rbac/scope";
import { APPOINTMENT_STATUS_LABELS, APPOINTMENT_STATUS_TONE, APPOINTMENT_TYPE_LABELS } from "@/lib/labels";
import { code, dateToIstanbulLocal, fmtDateTime } from "@/lib/format";
import { formatPhone } from "@/lib/normalize";
import { Badge, Card, DefList, PageHeader } from "@/components/ui/primitives";
import { HistoryPanel } from "@/components/record/panels";
import { AppointmentForm, StatusButtons } from "../forms";
import { appointmentFormOptions } from "../options";

export const metadata = { title: "Randevu" };

export default async function AppointmentDetail({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireActor();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const a = await prisma.appointment.findFirst({
    where: { id, ...appointmentScope(actor) },
    include: {
      contact: { select: { id: true, fullName: true, primaryPhone: true } },
      opportunity: { select: { id: true, number: true, title: true } },
      project: { select: { id: true, number: true, name: true } },
    },
  });
  if (!a) notFound();
  const canManage = actor.perms.has("calendar.manage");
  const people = await prisma.user.findMany({ where: { id: { in: [a.assignedUserId, a.createdById].filter(Boolean) as string[] } }, select: { id: true, name: true } });
  const name = (uid: string | null) => people.find((p) => p.id === uid)?.name ?? null;
  const quick =
    a.status === "COMPLETED" || a.status === "CANCELLED" || a.status === "NO_SHOW"
      ? []
      : [
          ...(a.status !== "CONFIRMED" && a.startAt ? [{ value: "CONFIRMED", label: "Müşteri onayladı", variant: "primary" as const }] : []),
          ...(a.startAt && a.startAt.getTime() < nowMs() ? [{ value: "COMPLETED", label: "Tamamlandı" }, { value: "NO_SHOW", label: "Gelmedi" }] : []),
          { value: "CANCELLED", label: "İptal et", variant: "danger" as const },
        ];

  return (
    <>
      <PageHeader
        back={{ href: a.startAt ? `/takvim?hafta=${dateToIstanbulLocal(a.startAt).slice(0, 10)}` : "/takvim", label: "Takvim" }}
        title={`${APPOINTMENT_TYPE_LABELS[a.type]} — ${a.contact.fullName}`}
        description={
          <span className="flex flex-wrap items-center gap-2">
            {a.startAt ? <span className="tabular">{fmtDateTime(a.startAt)}</span> : <span>Zaman bekliyor</span>}
            <Badge tone={APPOINTMENT_STATUS_TONE[a.status]}>{APPOINTMENT_STATUS_LABELS[a.status]}</Badge>
          </span>
        }
      />
      <div className="grid gap-6 xl:grid-cols-[1fr_320px]">
        <div className="min-w-0 space-y-6">
          {canManage ? (
            <Card title="Randevu bilgileri">
              <AppointmentForm
                d={{
                  id: a.id,
                  contactId: a.contactId,
                  type: a.type,
                  status: a.status,
                  opportunityId: a.opportunityId,
                  projectId: a.projectId,
                  startAt: dateToIstanbulLocal(a.startAt),
                  endAt: dateToIstanbulLocal(a.endAt),
                  location: a.location,
                  assignedUserId: a.assignedUserId,
                  requestedNote: a.requestedNote,
                  notes: a.notes,
                }}
                {...await appointmentFormOptions(actor, a.contactId)}
              />
            </Card>
          ) : (
            <Card title="Randevu bilgileri">
              <DefList
                items={[
                  { label: "Bitiş", value: a.endAt ? fmtDateTime(a.endAt) : null },
                  { label: "Yer", value: a.location },
                  { label: "Müşterinin tercihi", value: a.requestedNote },
                  { label: "Notlar", value: a.notes ? <span className="whitespace-pre-line">{a.notes}</span> : null },
                ]}
              />
            </Card>
          )}
          <HistoryPanel entityType={["appointment"]} entityIds={[a.id]} />
        </div>
        <div className="space-y-6">
          {canManage && quick.length ? (
            <Card title="Hızlı durum">
              <StatusButtons id={a.id} options={quick} />
            </Card>
          ) : null}
          <Card title="Bağlantılar">
            <DefList
              items={[
                { label: "Müşteri", value: <Link href={`/musteriler/${a.contact.id}`} className="text-accent-ink hover:underline">{a.contact.fullName}</Link> },
                { label: "Telefon", value: a.contact.primaryPhone ? <a href={`tel:${a.contact.primaryPhone}`} className="text-accent-ink hover:underline">{formatPhone(a.contact.primaryPhone)}</a> : null },
                { label: "Fırsat", value: a.opportunity ? <Link href={`/firsatlar/${a.opportunity.id}`} className="text-accent-ink hover:underline">{code.opportunity(a.opportunity.number)} {a.opportunity.title}</Link> : null },
                { label: "Proje", value: a.project ? <Link href={`/projeler/${a.project.id}`} className="text-accent-ink hover:underline">{code.project(a.project.number)} {a.project.name}</Link> : null },
                { label: "Atanan", value: name(a.assignedUserId) },
                { label: "Oluşturan", value: name(a.createdById) },
                { label: "Müşteri onayı", value: a.customerConfirmedAt ? fmtDateTime(a.customerConfirmedAt) : null },
              ]}
            />
          </Card>
        </div>
      </div>
    </>
  );
}
