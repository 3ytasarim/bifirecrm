import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/rbac/guard";
import { contactScope } from "@/lib/rbac/scope";
import { FIREPLACE_LABELS, SOURCE_LABELS } from "@/lib/labels";
import { code } from "@/lib/format";
import { userOptions } from "@/lib/queries";
import { Card, PageHeader } from "@/components/ui/primitives";
import { OpportunityForm } from "../forms";

export const metadata = { title: "Yeni fırsat" };
const opts = (l: Record<string, string>) => Object.entries(l).map(([value, label]) => ({ value, label }));

/** Mevcut müşteriye yeni fırsat (aynı müşterinin farklı talebi ayrı fırsat olarak saklanır). */
export default async function NewOpportunity({ searchParams }: { searchParams: Promise<{ musteri?: string }> }) {
  const actor = await requirePermission("opportunities.create");
  const { musteri } = await searchParams;
  const contact = musteri && /^[0-9a-f-]{36}$/i.test(musteri) ? await prisma.contact.findFirst({ where: { id: musteri, ...contactScope(actor) }, select: { id: true, number: true, fullName: true, city: true, district: true } }) : null;
  const contacts = contact
    ? undefined
    : (await prisma.contact.findMany({ where: contactScope(actor), orderBy: { updatedAt: "desc" }, take: 200, select: { id: true, number: true, fullName: true } })).map((c) => ({ value: c.id, label: `${c.fullName} (${code.contact(c.number)})` }));
  return (
    <>
      <PageHeader title="Yeni fırsat" description={contact ? `${contact.fullName} için yeni talep` : "Mevcut müşteriye yeni fırsat. Yeni kişi için Hızlı kayıt kullanın."} back={{ href: contact ? `/musteriler/${contact.id}` : "/firsatlar", label: contact ? contact.fullName : "Satış Fırsatları" }} />
      <Card>
        <OpportunityForm
          d={{ contactId: contact?.id, ownerId: actor.id, city: contact?.city, district: contact?.district, title: "" }}
          contacts={contacts}
          sources={opts(SOURCE_LABELS)}
          types={opts(FIREPLACE_LABELS)}
          users={await userOptions()}
          canAssign={actor.perms.has("opportunities.assign")}
        />
      </Card>
    </>
  );
}
