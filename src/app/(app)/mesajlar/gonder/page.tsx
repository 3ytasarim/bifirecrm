import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/rbac/guard";
import { contactScope } from "@/lib/rbac/scope";
import { whatsappConfig } from "@/lib/integrations/channels-config";
import { WA_TEMPLATE_CATEGORY_LABELS } from "@/lib/labels";
import { formatPhone } from "@/lib/normalize";
import { Card, EmptyState, PageHeader } from "@/components/ui/primitives";
import { TemplateSendForm } from "../forms";

export const metadata = { title: "WhatsApp şablonu gönder" };

export default async function SendToContactPage({ searchParams }: { searchParams: Promise<{ musteri?: string }> }) {
  const actor = await requirePermission("messages.send");
  const id = (await searchParams).musteri ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const c = await prisma.contact.findFirst({ where: { id, ...contactScope(actor) }, select: { id: true, fullName: true, primaryPhone: true, kvkkNoticeAt: true } });
  if (!c) notFound();
  const configured = Boolean(whatsappConfig());
  const templates = configured ? await prisma.whatsappTemplate.findMany({ where: { status: "APPROVED", paramCount: { gte: 0 } }, orderBy: { name: "asc" } }) : [];

  return (
    <>
      <PageHeader title="WhatsApp şablonu gönder" description={`${c.fullName}${c.primaryPhone ? ` · ${formatPhone(c.primaryPhone)}` : ""}`} back={{ href: `/musteriler/${c.id}`, label: c.fullName }} />
      <Card className="max-w-2xl">
        {!configured ? (
          <EmptyState title="WhatsApp bağlantısı yapılandırılmadı" description="Bağlantı kurulup şablonlar Meta'da onaylanınca buradan gönderilebilir (Entegrasyonlar)." />
        ) : !c.primaryPhone ? (
          <EmptyState title="Telefon numarası yok" description="Önce müşteri kartına telefon ekleyin." />
        ) : templates.length ? (
          <TemplateSendForm contactId={c.id} templates={templates.map((t) => ({ id: t.id, name: t.name, language: t.language, category: t.category, categoryLabel: WA_TEMPLATE_CATEGORY_LABELS[t.category] ?? t.category, body: t.body, paramCount: t.paramCount }))} />
        ) : (
          <EmptyState title="Onaylı şablon yok" description="Şablonlar Meta'da onaylandıktan sonra Entegrasyonlar › senkronize et." />
        )}
      </Card>
    </>
  );
}
