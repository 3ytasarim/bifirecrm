import { NextResponse, type NextRequest } from "next/server";

/**
 * Hızlı ön kontrol: oturum çerezi yoksa girişe yönlendir. Gerçek doğrulama (oturum geçerliliği, rol, satır yetkisi)
 * her sayfada ve action'da sunucu tarafında yapılır; bu katman yalnız gereksiz render'ı önler.
 */
const PUBLIC = [/^\/giris/, /^\/sifremi-unuttum/, /^\/sifre-belirle/, /^\/api\/health/, /^\/api\/v1\/intake\//, /^\/api\/v1\/webhooks\/meta$/, /^\/yetkisiz/];
// /api/v1/intake/* oturumsuzdur ama HMAC imzası + zaman penceresi + nonce ile korunur (lib/integrations/website-request.ts).
// /api/v1/webhooks/meta oturumsuzdur ama X-Hub-Signature-256 (Meta uygulama sırrı) doğrulanmadan gövde işlenmez.
// /api/v1/oauth/google/* oturum ister (PUBLIC değil) ve route içinde ayrıca integrations.manage izni denetlenir.

/**
 * Nonce tabanlı CSP: her istekte yeni nonce; Next.js istek başlığındaki CSP'den nonce'u okuyup kendi satır içi
 * script'lerine ekler (tüm sayfalar dinamik render — kök layout çerez okur). 'strict-dynamic' ile yalnız nonce'lu
 * script'in yüklediği script'ler çalışır; 'unsafe-inline' script YOK. Stil: Tailwind + style özniteliği için 'unsafe-inline'
 * (öznitelik stilleri nonce alamaz; script çalıştırmaz).
 */
function csp(nonce: string) {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "base-uri 'self'",
    "object-src 'none'",
  ].join("; ");
}

function withCsp(req: NextRequest) {
  const nonce = btoa(crypto.randomUUID());
  const policy = csp(nonce);
  const headers = new Headers(req.headers);
  headers.set("x-nonce", nonce);
  headers.set("Content-Security-Policy", policy);
  const res = NextResponse.next({ request: { headers } });
  res.headers.set("Content-Security-Policy", policy);
  return res;
}

export function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  if (PUBLIC.some((r) => r.test(pathname))) return withCsp(req);
  if (!req.cookies.get("bcrm_session")) {
    if (pathname.startsWith("/api/")) return new NextResponse("Oturum gerekli", { status: 401 });
    const url = req.nextUrl.clone();
    url.pathname = "/giris";
    url.search = pathname === "/" ? "" : `?next=${encodeURIComponent(pathname + search)}`;
    return NextResponse.redirect(url);
  }
  return withCsp(req);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|bg/).*)"],
};
