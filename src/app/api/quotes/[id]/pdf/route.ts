import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { audit } from "@/lib/audit";
import { getActorOrNull } from "@/lib/rbac/guard";
import { quoteScope } from "@/lib/rbac/scope";
import { code } from "@/lib/format";
import { renderQuotePdf } from "@/lib/quotes/pdf";
import { quotePdfInput } from "@/lib/services/quotes";
import { storage } from "@/lib/storage";

export const runtime = "nodejs";

const WATERMARK: Record<string, string | null> = { DRAFT: "TASLAK", PENDING_APPROVAL: "ONAY BEKLİYOR", APPROVED: null };

/**
 * Teklif PDF'i. Gönderilmiş (SENT/ACCEPTED/REJECTED) teklifte müşteriye giden, değişmez dosya döner.
 * Diğer durumlarda anlık üretilir; onaylanmamış teklifte filigran basılır (yanlışlıkla müşteriye gitmesin).
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new NextResponse("Bulunamadı", { status: 404 });
  const actor = await getActorOrNull();
  if (!actor) return new NextResponse("Oturum gerekli", { status: 401 });
  const q = await prisma.quote.findFirst({ where: { id, ...quoteScope(actor) }, select: { id: true, number: true, version: true, status: true, pdfAttachmentId: true } });
  if (!q) return new NextResponse("Bulunamadı", { status: 404 });

  const name = `Teklif-${code.quote(q.number)}${q.version > 1 ? `-s${q.version}` : ""}${q.pdfAttachmentId ? "" : "-onizleme"}.pdf`;
  let body: Buffer;
  if (q.pdfAttachmentId) {
    const a = await prisma.attachment.findUnique({ where: { id: q.pdfAttachmentId }, select: { storageKey: true, deletedAt: true } });
    if (!a || a.deletedAt) return new NextResponse("Gönderilen PDF bulunamadı", { status: 404 });
    body = await (await storage()).get(a.storageKey);
  } else {
    const { input } = await quotePdfInput(id, WATERMARK[q.status] ?? "TASLAK");
    if (!input.items.length) return new NextResponse("Teklifte kalem yok", { status: 409 });
    try {
      body = await renderQuotePdf(input);
    } catch (e) {
      return new NextResponse(e instanceof Error ? e.message : "PDF üretilemedi", { status: 409 });
    }
  }
  await audit({ actorId: actor.id, action: "quote_pdf", entityType: "quote", entityId: id, summary: name });
  return new NextResponse(new Uint8Array(body), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Length": String(body.length),
      "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(name)}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
