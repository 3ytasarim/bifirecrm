import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { apiError, readSignedWebsiteRequest } from "@/lib/integrations/website-request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({ submissionIds: z.array(z.string().trim().min(8).max(64).regex(/^[A-Za-z0-9_-]+$/)).max(500) });

/**
 * POST /api/v1/intake/website/status — mutabakat. Site son N saatteki başvuru kimliklerini gönderir,
 * CRM hangilerini zaten aldığını döner; site yalnız eksikleri (fotoğraflarıyla) yeniden gönderir.
 * Yanıtta kişisel veri yoktur, yalnız kimlikler.
 */
export async function POST(req: NextRequest) {
  const signed = await readSignedWebsiteRequest(req, 64 * 1024);
  if (!signed.ok) return signed.response;
  let parsed;
  try {
    parsed = schema.safeParse(JSON.parse(signed.rawBody));
  } catch {
    return apiError(400, "invalid_json", "Gövde geçerli JSON değil.");
  }
  if (!parsed.success) return apiError(422, "invalid_payload", "submissionIds listesi geçersiz.");
  const rows = await prisma.integrationEvent.findMany({
    where: { provider: "BIFIRE_WEBSITE", externalEventId: { in: parsed.data.submissionIds } },
    select: { externalEventId: true },
  });
  return NextResponse.json({ received: rows.map((r) => r.externalEventId) }, { headers: { "Cache-Control": "no-store" } });
}
