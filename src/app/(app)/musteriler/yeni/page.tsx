import { requirePermission } from "@/lib/rbac/guard";
import { CHANNEL_LABELS, SOURCE_LABELS } from "@/lib/labels";
import { userOptions } from "@/lib/queries";
import { PageHeader } from "@/components/ui/primitives";
import { ContactForm } from "../contact-form";
import { createContactAction } from "../actions";

export const metadata = { title: "Yeni müşteri" };

export default async function NewContactPage() {
  const actor = await requirePermission("contacts.create");
  return (
    <>
      <PageHeader title="Yeni müşteri" description="Talep/fırsat açmadan yalnız müşteri kartı oluşturur. Gelen talep için Hızlı kayıt kullanın." back={{ href: "/musteriler", label: "Müşteriler" }} />
      <ContactForm
        action={createContactAction}
        d={{ ownerId: actor.id }}
        sources={Object.entries(SOURCE_LABELS).map(([value, label]) => ({ value, label }))}
        channels={Object.entries(CHANNEL_LABELS).map(([value, label]) => ({ value, label }))}
        users={await userOptions()}
        canAssign={actor.perms.has("opportunities.assign")}
      />
    </>
  );
}
