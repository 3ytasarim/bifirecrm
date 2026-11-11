import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireActor } from "@/lib/rbac/guard";
import { contactScope, opportunityScope, projectScope } from "@/lib/rbac/scope";
import { contactSearchWhere } from "@/lib/search";
import { PROJECT_STAGE_LABELS, STAGE_LABELS } from "@/lib/labels";
import { code } from "@/lib/format";
import { formatPhone } from "@/lib/normalize";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui/primitives";

export const metadata = { title: "Arama" };

export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const actor = await requireActor();
  const q = (await searchParams).q?.trim() ?? "";
  if (q.length < 2) {
    return (
      <>
        <PageHeader title="Arama" />
        <Card>
          <EmptyState title="En az 2 karakter yazın" description="Ad, telefon, e-posta, şirket ya da M-/F-/P- numarasıyla arayın." />
        </Card>
      </>
    );
  }
  const num = /^([mfp])-?0*(\d+)$/i.exec(q);
  const [contacts, opps, projects] = await Promise.all([
    !num || num[1].toLowerCase() === "m"
      ? prisma.contact.findMany({ where: { AND: [contactScope(actor), contactSearchWhere(q)] }, take: 20, select: { id: true, number: true, fullName: true, primaryPhone: true, primaryEmail: true, district: true } })
      : [],
    !num || num[1].toLowerCase() === "f"
      ? prisma.opportunity.findMany({
          where: { AND: [opportunityScope(actor), num ? { number: Number(num[2]) } : { OR: [{ title: { contains: q, mode: "insensitive" } }, { contact: contactSearchWhere(q) }] }] },
          take: 20,
          select: { id: true, number: true, title: true, stage: true, contact: { select: { fullName: true } } },
        })
      : [],
    !num || num[1].toLowerCase() === "p"
      ? prisma.project.findMany({
          where: { AND: [projectScope(actor), num ? { number: Number(num[2]) } : { OR: [{ name: { contains: q, mode: "insensitive" } }, { contact: contactSearchWhere(q) }] }] },
          take: 20,
          select: { id: true, number: true, name: true, stage: true },
        })
      : [],
  ]);
  const none = !contacts.length && !opps.length && !projects.length;
  return (
    <>
      <PageHeader title={`“${q}” için sonuçlar`} description="Yalnız erişim yetkiniz olan kayıtlar listelenir." />
      {none ? (
        <Card>
          <EmptyState title="Sonuç bulunamadı" />
        </Card>
      ) : (
        <div className="grid gap-6 lg:grid-cols-3">
          <Card title={`Müşteriler (${contacts.length})`} padded={false}>
            <ul className="divide-y divide-line">
              {contacts.map((c) => (
                <li key={c.id}>
                  <Link href={`/musteriler/${c.id}`} className="block px-5 py-3 hover:bg-surface-2/50">
                    <span className="block text-sm font-medium">{c.fullName}</span>
                    <span className="block text-xs text-muted">{[code.contact(c.number), formatPhone(c.primaryPhone), c.primaryEmail, c.district].filter(Boolean).join(" · ")}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
          <Card title={`Fırsatlar (${opps.length})`} padded={false}>
            <ul className="divide-y divide-line">
              {opps.map((o) => (
                <li key={o.id}>
                  <Link href={`/firsatlar/${o.id}`} className="flex items-start justify-between gap-2 px-5 py-3 hover:bg-surface-2/50">
                    <span>
                      <span className="block text-sm font-medium">{o.contact.fullName}</span>
                      <span className="block text-xs text-muted">
                        {code.opportunity(o.number)} · {o.title}
                      </span>
                    </span>
                    <Badge tone="info">{STAGE_LABELS[o.stage]}</Badge>
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
          <Card title={`Projeler (${projects.length})`} padded={false}>
            <ul className="divide-y divide-line">
              {projects.map((p) => (
                <li key={p.id}>
                  <Link href={`/projeler/${p.id}`} className="flex items-start justify-between gap-2 px-5 py-3 hover:bg-surface-2/50">
                    <span>
                      <span className="block text-sm font-medium">{p.name}</span>
                      <span className="block text-xs text-muted">{code.project(p.number)}</span>
                    </span>
                    <Badge tone="info">{PROJECT_STAGE_LABELS[p.stage]}</Badge>
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      )}
    </>
  );
}
