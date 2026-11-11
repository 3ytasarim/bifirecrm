import type { LeadSource } from "@prisma/client";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/rbac/guard";
import { FIREPLACE_LABELS, SOURCE_LABELS } from "@/lib/labels";
import { userOptions } from "@/lib/queries";
import { PageHeader } from "@/components/ui/primitives";
import { IntakeForm, type LeadPrefill } from "./intake-form";

export const metadata = { title: "Hızlı kayıt" };

/** Web formu dışı kanallar elle girilir; web/reklam kaynakları Faz 2/4'te entegrasyonla otomatik gelir. */
const MANUAL_SOURCES = ["PHONE", "SHOWROOM", "REFERRAL", "WHATSAPP", "INSTAGRAM_DM", "MANUAL", "OTHER"] as const;

export default async function NewIntakePage({ searchParams }: { searchParams: Promise<{ talep?: string }> }) {
  const actor = await requirePermission("contacts.create");
  const { talep } = await searchParams;
  let prefill: LeadPrefill | undefined;
  if (talep) {
    await requirePermission("leads.process");
    if (!/^[0-9a-f-]{36}$/i.test(talep)) notFound();
    const lead = await prisma.lead.findUnique({ where: { id: talep } });
    if (!lead) notFound();
    // Zaten işlenmiş (ör. kaydetme sonrası sayfa yeniden çizildi ya da başka biri işledi) → fırsata git.
    if (lead.status !== "RECEIVED") redirect(lead.opportunityId ? `/firsatlar/${lead.opportunityId}` : "/talepler");
    const payload = (lead.payload ?? {}) as { productName?: string | null; categoryName?: string | null; consent?: { kvkkAcknowledged?: boolean } };
    prefill = {
      leadId: lead.id,
      name: lead.name,
      phone: lead.phone,
      email: lead.email,
      district: lead.district,
      source: lead.source,
      productCategory: payload.categoryName ?? null,
      productModel: payload.productName ?? null,
      message: lead.message,
      kvkkNotice: Boolean(payload.consent?.kvkkAcknowledged),
    };
  }
  const sources: LeadSource[] = prefill && !(MANUAL_SOURCES as readonly string[]).includes(prefill.source) ? [prefill.source as LeadSource, ...MANUAL_SOURCES] : [...MANUAL_SOURCES];
  return (
    <>
      <PageHeader
        title={prefill ? "Bekleyen talebi işle" : "Hızlı kayıt"}
        description={prefill ? "Bu talep birden fazla müşteriyle eşleşti. Doğru müşteriyi seçin ya da bilerek yeni müşteri açın." : "Telefon, showroom, referans veya mesajla gelen talebi kaydedin."}
        back={{ href: "/talepler", label: "Talepler" }}
      />
      <IntakeForm
        prefill={prefill}
        sources={sources.map((s) => ({ value: s, label: SOURCE_LABELS[s] }))}
        fireplaceTypes={Object.entries(FIREPLACE_LABELS).map(([value, label]) => ({ value, label }))}
        users={await userOptions()}
        defaultOwner={actor.id}
        canAssign={actor.perms.has("opportunities.assign")}
      />
    </>
  );
}
