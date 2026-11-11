import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireActor } from "@/lib/rbac/guard";
import { contactScope, opportunityScope, projectScope } from "@/lib/rbac/scope";
import { contactSearchWhere } from "@/lib/search";
import { code } from "@/lib/format";
import { formatPhone } from "@/lib/normalize";
import { Card, EmptyState, PageHeader } from "@/components/ui/primitives";
import { buttonClass, inputClass } from "@/components/ui/styles";
import { AppointmentForm } from "../forms";
import { appointmentFormOptions } from "../options";

export const metadata = { title: "Yeni randevu" };

const isId = (v: string | undefined): v is string => !!v && /^[0-9a-f-]{36}$/i.test(v);

/** Bağlam: ?musteri= / ?firsat= / ?proje=. Hiçbiri yoksa önce müşteri seçilir. */
export default async function NewAppointmentPage({ searchParams }: { searchParams: Promise<{ musteri?: string; firsat?: string; proje?: string; tur?: string; q?: string }> }) {
  const actor = await requireActor();
  if (!actor.perms.has("calendar.manage")) redirect("/yetkisiz");
  const sp = await searchParams;

  let contactId: string | null = null;
  let opportunityId: string | null = null;
  let projectId: string | null = null;
  if (isId(sp.proje)) {
    const p = await prisma.project.findFirst({ where: { id: sp.proje, ...projectScope(actor) }, select: { id: true, contactId: true, opportunityId: true } });
    if (!p) notFound();
    [contactId, projectId, opportunityId] = [p.contactId, p.id, p.opportunityId];
  } else if (isId(sp.firsat)) {
    const o = await prisma.opportunity.findFirst({ where: { id: sp.firsat, ...opportunityScope(actor) }, select: { id: true, contactId: true } });
    if (!o) notFound();
    [contactId, opportunityId] = [o.contactId, o.id];
  } else if (isId(sp.musteri)) {
    const c = await prisma.contact.findFirst({ where: { id: sp.musteri, ...contactScope(actor) }, select: { id: true } });
    if (!c) notFound();
    contactId = c.id;
  }

  if (!contactId) {
    const q = sp.q?.trim();
    const found = q ? await prisma.contact.findMany({ where: { AND: [contactScope(actor), contactSearchWhere(q)] }, orderBy: { updatedAt: "desc" }, take: 20, select: { id: true, number: true, fullName: true, primaryPhone: true } }) : [];
    return (
      <>
        <PageHeader back={{ href: "/takvim", label: "Takvim" }} title="Yeni randevu" description="Önce müşteriyi seçin." />
        <Card>
          <form className="flex gap-2" role="search">
            <input name="q" defaultValue={q} placeholder="Ad, telefon, e-posta ya da M-no" className={inputClass()} aria-label="Müşteri ara" autoFocus />
            <button className={buttonClass("secondary")}>Ara</button>
          </form>
          {q ? (
            found.length ? (
              <ul className="mt-4 divide-y divide-line rounded-lg border border-line">
                {found.map((c) => (
                  <li key={c.id}>
                    <Link href={`/takvim/yeni?musteri=${c.id}`} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm hover:bg-surface-2/50">
                      <span className="font-medium">{c.fullName}</span>
                      <span className="text-xs tabular text-muted">
                        {code.contact(c.number)} {c.primaryPhone ? `· ${formatPhone(c.primaryPhone)}` : ""}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState title="Müşteri bulunamadı" description="Yeni müşteri için Hızlı kayıt kullanın." action={<Link href="/talepler/yeni" className={buttonClass()}>Hızlı kayıt</Link>} />
            )
          ) : null}
        </Card>
      </>
    );
  }

  const [contact, options] = await Promise.all([prisma.contact.findUniqueOrThrow({ where: { id: contactId }, select: { id: true, fullName: true, address: true, district: true, city: true } }), appointmentFormOptions(actor, contactId)]);
  const type = sp.tur && options.types.some((t) => t.value === sp.tur) ? sp.tur : "SITE_SURVEY";
  return (
    <>
      <PageHeader
        back={{ href: "/takvim", label: "Takvim" }}
        title="Yeni randevu"
        description={
          <Link href={`/musteriler/${contact.id}`} className="text-accent-ink hover:underline">
            {contact.fullName}
          </Link>
        }
      />
      <Card>
        <AppointmentForm
          d={{
            contactId: contact.id,
            type,
            status: "REQUESTED",
            opportunityId,
            projectId,
            startAt: "",
            endAt: "",
            location: [contact.address, contact.district, contact.city].filter(Boolean).join(", ") || null,
            assignedUserId: actor.id,
            requestedNote: null,
            notes: null,
          }}
          {...options}
        />
      </Card>
    </>
  );
}
