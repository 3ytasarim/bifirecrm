import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { WEBSITE_SOURCE, type StoredWebsitePayload } from "@/lib/integrations/website-payload";
import { ingestInboundLead, type IngestOutcome } from "./lead-ingest";

export { WEBSITE_OWNER_SETTING } from "./lead-ingest";
export type WebsiteIngestOutcome = IngestOutcome;

function detailsText(p: StoredWebsitePayload) {
  return [
    p.message,
    p.topic ? `Konu: ${p.topic}` : null,
    p.productName ? `Ürün: ${p.productName}` : null,
    p.categoryName && !p.productName ? `Kategori: ${p.categoryName}` : null,
    p.selection ? `Seçim: ${p.selection}` : null,
    p.projectStage ? `Proje aşaması: ${p.projectStage}` : null,
    p.timeline ? `Zamanlama: ${p.timeline}` : null,
    p.sourcePath ? `Sayfa: ${p.sourcePath}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Worker işi (website.ingest): olaydaki web başvurusunu CRM kayıtlarına dönüştürür (kurallar: lead-ingest.ts).
 * İdempotent: aynı submissionId ikinci kez işlenmez.
 */
export async function ingestWebsiteEvent(eventId: string): Promise<{ leadId: string; outcome: WebsiteIngestOutcome }> {
  const ev = await prisma.integrationEvent.findUnique({ where: { id: eventId } });
  if (!ev || ev.provider !== "BIFIRE_WEBSITE") throw new Error(`Olay bulunamadı: ${eventId}`);
  const p = ev.payload as unknown as StoredWebsitePayload;
  const consentAt = new Date(p.consent.consentAt ?? p.submittedAt);

  const result = await ingestInboundLead({
    source: WEBSITE_SOURCE[p.formType],
    submissionId: p.submissionId,
    formType: p.formType.toLowerCase(),
    name: p.name,
    phone: p.phone,
    email: p.email,
    district: p.district,
    details: detailsText(p),
    titleHint: p.productName || p.topic || p.categoryName || null,
    productCategory: p.categoryName,
    productModel: p.productName,
    payload: p as unknown as Prisma.InputJsonValue,
    receivedAt: new Date(p.submittedAt),
    consent: {
      kvkkNotice: p.consent.kvkkAcknowledged,
      noticeAt: consentAt,
      source: `website:${p.sourcePath ?? p.formType.toLowerCase()}`,
      evidence: { submissionId: p.submissionId, formType: p.formType, consentAt: p.consent.consentAt ?? p.submittedAt, noticeVersion: p.consent.noticeVersion, sourcePath: p.sourcePath } as Prisma.InputJsonValue,
    },
    files: p.files,
  });

  await prisma.integrationEvent.update({ where: { id: ev.id }, data: { status: "SUCCESS", processedAt: new Date(), leadId: result.leadId } });
  return result;
}

/** Worker hata verdiğinde olayın durumunu da günceller (Entegrasyonlar ekranında görünür). */
export async function markWebsiteEventFailed(eventId: string, error: string, dead: boolean) {
  await prisma.integrationEvent.update({ where: { id: eventId }, data: { status: dead ? "DEAD_LETTER" : "RETRY", attempts: { increment: 1 }, lastError: error.slice(0, 2000) } }).catch(() => {});
  await prisma.integrationConnection.update({ where: { provider: "BIFIRE_WEBSITE" }, data: { lastErrorAt: new Date(), lastError: error.slice(0, 500) } }).catch(() => {});
}
