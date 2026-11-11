import { NextResponse, type NextRequest } from "next/server";

/**
 * Hızlı ön kontrol: oturum çerezi yoksa girişe yönlendir. Gerçek doğrulama (oturum geçerliliği, rol, satır yetkisi)
 * her sayfada ve action'da sunucu tarafında yapılır; bu katman yalnız gereksiz render'ı önler.
 */
const PUBLIC = [/^\/giris/, /^\/sifremi-unuttum/, /^\/sifre-belirle/, /^\/api\/health/, /^\/api\/v1\/intake\//, /^\/yetkisiz/];
// /api/v1/intake/* oturumsuzdur ama HMAC imzası + zaman penceresi + nonce ile korunur (lib/integrations/website-request.ts).

export function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  if (PUBLIC.some((r) => r.test(pathname))) return NextResponse.next();
  if (!req.cookies.get("bcrm_session")) {
    if (pathname.startsWith("/api/")) return new NextResponse("Oturum gerekli", { status: 401 });
    const url = req.nextUrl.clone();
    url.pathname = "/giris";
    url.search = pathname === "/" ? "" : `?next=${encodeURIComponent(pathname + search)}`;
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg).*)"],
};
