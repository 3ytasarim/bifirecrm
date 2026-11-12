import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { storage } from "@/lib/storage";
import { processAndStore, UploadError } from "@/lib/storage/files";
import { enqueue } from "@/lib/jobs/queue";
import { MAX_WEBSITE_ATTACHMENT_BYTES, type StoredWebsitePayload, type WebsitePayload } from "@/lib/integrations/website-payload";

export type AcceptResult = { ok: true; duplicate: boolean; eventId?: string; status?: string } | { ok: false; error: string };

/**
 * Doğrulanmış site başvurusunu CRM'e alır: dosyaları özel depoya yazar, olay + "website.ingest" işi açar.
 * İki yoldan çağrılır: site → CRM imzalı POST (api/v1/intake/website) ve CRM → site çekme (website-pull).
 * submissionId tekil anahtardır; aynı başvuru ikinci kez gelirse duplicate:true döner, yeni kayıt açılmaz.
 * next/* import etmez (worker'da da çalışır).
 */
export async function acceptWebsitePayload(p: WebsitePayload, requestId: string | null): Promise<AcceptResult> {
  const existing = await prisma.integrationEvent.findUnique({
    where: { provider_externalEventId: { provider: "BIFIRE_WEBSITE", externalEventId: p.submissionId } },
    select: { id: true, status: true },
  });
  if (existing) return { ok: true, duplicate: true, eventId: existing.id, status: existing.status };

  // Dosyalar: içerikten tür tespiti, EXIF temizliği, (varsa) ClamAV; reddedilen dosya başvuruyu düşürmez, olaya not edilir.
  const files: StoredWebsitePayload["files"] = [];
  const rejected: string[] = [];
  for (const a of p.attachments) {
    const buf = Buffer.from(a.dataBase64, "base64");
    if (buf.length === 0 || buf.length > MAX_WEBSITE_ATTACHMENT_BYTES) {
      rejected.push(`${a.name}: boyut`);
      continue;
    }
    try {
      const stored = await processAndStore(new File([buf], a.name, { type: a.mimeType }));
      files.push({ ...stored, thumbnailKey: stored.thumbnailKey ?? null, width: stored.width ?? null, height: stored.height ?? null, scanStatus: stored.scanStatus ?? "NOT_SCANNED", exifStripped: stored.exifStripped ?? false });
    } catch (e) {
      rejected.push(`${a.name}: ${e instanceof UploadError ? e.message : "işlenemedi"}`);
    }
  }

  const { attachments: _omit, ...rest } = p;
  void _omit;
  const stored: StoredWebsitePayload = { ...rest, files };
  try {
    const event = await prisma.$transaction(async (t) => {
      const ev = await t.integrationEvent.create({
        data: {
          provider: "BIFIRE_WEBSITE",
          externalEventId: p.submissionId,
          eventType: `form.${p.formType.toLowerCase()}`,
          status: "PENDING",
          requestId,
          payload: stored as unknown as Prisma.InputJsonValue,
          lastError: rejected.length ? `Reddedilen ek: ${rejected.join("; ")}`.slice(0, 2000) : null,
        },
      });
      await enqueue("website.ingest", { eventId: ev.id }, { eventId: ev.id }, t);
      await t.integrationConnection.upsert({
        where: { provider: "BIFIRE_WEBSITE" },
        create: { provider: "BIFIRE_WEBSITE", status: "ACTIVE", lastSyncAt: new Date() },
        update: { status: "ACTIVE", lastSyncAt: new Date() },
      });
      return ev;
    });
    return { ok: true, duplicate: false, eventId: event.id };
  } catch (e) {
    // Yazılan dosyaları geri al (olay kaydedilemedi → yeniden denenecek).
    const s = await storage();
    for (const f of files) {
      await s.delete(f.storageKey).catch(() => {});
      if (f.thumbnailKey) await s.delete(f.thumbnailKey).catch(() => {});
    }
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return { ok: true, duplicate: true };
    console.error("[website-accept] kayıt hatası:", e instanceof Error ? e.message : "bilinmeyen");
    return { ok: false, error: "internal_error" };
  }
}
