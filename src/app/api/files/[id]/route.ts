import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { audit } from "@/lib/audit";
import { getActorOrNull } from "@/lib/rbac/guard";
import { resolveRecord, type RecordRef } from "@/lib/services/records";
import { storage, verifyFileToken } from "@/lib/storage";

/**
 * Özel dosya indirme. Üç kat kontrol:
 *  1) Oturum açmış kullanıcı + files.download izni,
 *  2) Bağlantı imzası bu kullanıcıya ve bu dosyaya ait, süresi dolmamış,
 *  3) Kullanıcı dosyanın bağlı olduğu kayda (müşteri/fırsat/proje) erişebiliyor.
 * Bağlantı başka bir kullanıcıya iletilirse 2. ve 3. adımda reddedilir.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sp = req.nextUrl.searchParams;
  const variant = sp.get("v") === "thumb" ? "thumb" : "file";
  const actor = await getActorOrNull();
  if (!actor) return new NextResponse("Oturum gerekli", { status: 401 });
  if (!actor.perms.has("files.download")) return new NextResponse("Yetkisiz", { status: 403 });
  if (!verifyFileToken(id, actor.id, variant, Number(sp.get("exp")), sp.get("sig") ?? "")) {
    return new NextResponse("Bağlantının süresi dolmuş ya da geçersiz. Sayfayı yenileyip tekrar deneyin.", { status: 403 });
  }
  const a = await prisma.attachment.findUnique({ where: { id } });
  if (!a || a.deletedAt) return new NextResponse("Bulunamadı", { status: 404 });
  const ref: RecordRef | null = a.projectId ? { kind: "project", id: a.projectId } : a.opportunityId ? { kind: "opportunity", id: a.opportunityId } : a.contactId ? { kind: "contact", id: a.contactId } : null;
  if (!ref) return new NextResponse("Bulunamadı", { status: 404 });
  try {
    await resolveRecord(actor, ref);
  } catch {
    return new NextResponse("Yetkisiz", { status: 403 });
  }

  const key = variant === "thumb" ? a.thumbnailKey : a.storageKey;
  if (!key) return new NextResponse("Bulunamadı", { status: 404 });
  const s = await storage();
  if (variant === "file") {
    await audit({ actorId: actor.id, action: "file_download", entityType: "attachment", entityId: a.id, summary: a.originalName });
    const presigned = await s.presignedGetUrl(key, a.originalName, 60);
    if (presigned) return NextResponse.redirect(presigned, { status: 302, headers: { "Cache-Control": "no-store" } });
  }
  const body = await s.get(key);
  const inline = variant === "thumb" || a.mimeType.startsWith("image/") || a.mimeType === "application/pdf";
  return new NextResponse(new Uint8Array(body), {
    headers: {
      "Content-Type": variant === "thumb" ? "image/webp" : a.mimeType,
      "Content-Length": String(body.length),
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(a.originalName)}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
    },
  });
}
