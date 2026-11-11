import { NextResponse, type NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { storage } from "@/lib/storage";
import { processAndStore, UploadError } from "@/lib/storage/files";
import { enqueue } from "@/lib/jobs/queue";
import { apiError, readSignedWebsiteRequest } from "@/lib/integrations/website-request";
import { MAX_WEBSITE_ATTACHMENT_BYTES, MAX_WEBSITE_BODY_BYTES, websitePayloadSchema, type StoredWebsitePayload } from "@/lib/integrations/website-payload";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/v1/intake/website — siteden gelen form başvurusu (HMAC imzalı).
 * Hızlı yanıt verir: doğrula → dosyaları özel depoya yaz → olay + iş kaydı → 202. Müşteri/fırsat/görev
 * oluşturma worker'da (website.ingest) yapılır; hata olursa iş kuyruğu yeniden dener.
 * Aynı submissionId ikinci kez gelirse 200 + duplicate:true döner (site tekrar göndermeyi bırakır).
 */
export async function POST(req: NextRequest) {
  const signed = await readSignedWebsiteRequest(req, MAX_WEBSITE_BODY_BYTES);
  if (!signed.ok) return signed.response;

  let json: unknown;
  try {
    json = JSON.parse(signed.rawBody);
  } catch {
    return apiError(400, "invalid_json", "Gövde geçerli JSON değil.");
  }
  const parsed = websitePayloadSchema.safeParse(json);
  if (!parsed.success) {
    const fields = [...new Set(parsed.error.issues.map((i) => i.path.join(".")))].slice(0, 10).join(", ");
    return apiError(422, "invalid_payload", `Geçersiz alanlar: ${fields}`);
  }
  const p = parsed.data;

  const existing = await prisma.integrationEvent.findUnique({ where: { provider_externalEventId: { provider: "BIFIRE_WEBSITE", externalEventId: p.submissionId } }, select: { id: true, status: true } });
  if (existing) return NextResponse.json({ ok: true, duplicate: true, eventId: existing.id, status: existing.status });

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
          requestId: req.headers.get("x-bifire-nonce"),
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
    return NextResponse.json({ ok: true, duplicate: false, eventId: event.id }, { status: 202 });
  } catch (e) {
    // Yazılan dosyaları geri al (olay kaydedilemedi → site yeniden gönderecek).
    const s = await storage();
    for (const f of files) {
      await s.delete(f.storageKey).catch(() => {});
      if (f.thumbnailKey) await s.delete(f.thumbnailKey).catch(() => {});
    }
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return NextResponse.json({ ok: true, duplicate: true });
    }
    console.error("[intake/website] kayıt hatası:", e instanceof Error ? e.message : "bilinmeyen");
    return apiError(500, "internal_error", "Başvuru kaydedilemedi; yeniden deneyin.");
  }
}
