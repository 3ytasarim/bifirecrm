import { NextResponse, type NextRequest } from "next/server";
import { acceptWebsitePayload } from "@/lib/services/website-accept";
import { apiError, readSignedWebsiteRequest } from "@/lib/integrations/website-request";
import { MAX_WEBSITE_BODY_BYTES, websitePayloadSchema } from "@/lib/integrations/website-payload";

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

  const r = await acceptWebsitePayload(p, req.headers.get("x-bifire-nonce"));
  if (!r.ok) return apiError(500, "internal_error", "Başvuru kaydedilemedi; yeniden deneyin.");
  if (r.duplicate) return NextResponse.json({ ok: true, duplicate: true, eventId: r.eventId, status: r.status });
  return NextResponse.json({ ok: true, duplicate: false, eventId: r.eventId }, { status: 202 });
}
