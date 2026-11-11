import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/rbac/guard";
import { contactScope } from "@/lib/rbac/scope";
import { CHANNEL_LABELS, SOURCE_LABELS } from "@/lib/labels";
import { code } from "@/lib/format";
import { formatPhone } from "@/lib/normalize";
import { userOptions } from "@/lib/queries";
import { PageHeader } from "@/components/ui/primitives";
import { ContactForm } from "../../contact-form";
import { updateContactAction } from "../../actions";

export const metadata = { title: "Müşteri düzenle" };

export default async function EditContact({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requirePermission("contacts.edit");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const c = await prisma.contact.findFirst({ where: { id, ...contactScope(actor) }, include: { organization: { select: { name: true } } } });
  if (!c) notFound();
  return (
    <>
      <PageHeader title={`${c.fullName} — düzenle`} description={code.contact(c.number)} back={{ href: `/musteriler/${id}`, label: c.fullName }} />
      <ContactForm
        action={updateContactAction}
        d={{
          id,
          firstName: c.firstName,
          lastName: c.lastName,
          title: c.title,
          organizationName: c.organization?.name,
          phone: formatPhone(c.primaryPhone),
          email: c.primaryEmail,
          city: c.city,
          district: c.district,
          address: c.address,
          preferredChannel: c.preferredChannel,
          source: c.source,
          tags: c.tags,
          notes: c.notes,
          ownerId: c.ownerId,
          kvkkNotice: !!c.kvkkNoticeAt,
          marketingConsent: c.marketingConsent,
        }}
        sources={Object.entries(SOURCE_LABELS).map(([value, label]) => ({ value, label }))}
        channels={Object.entries(CHANNEL_LABELS).map(([value, label]) => ({ value, label }))}
        users={await userOptions()}
        canAssign={actor.perms.has("opportunities.assign")}
      />
    </>
  );
}
