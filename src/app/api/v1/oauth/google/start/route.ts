import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { getActorOrNull } from "@/lib/rbac/guard";
import { GOOGLE_STATE_COOKIE, googleClient, startAuthorization } from "@/lib/integrations/google";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const back = (q: string) => NextResponse.redirect(new URL(`/entegrasyonlar?${q}`, env().APP_URL), { headers: { "Cache-Control": "no-store" } });

/**
 * GET /api/v1/oauth/google/start — yalnız oturumlu ve integrations.manage izinli kullanıcı.
 * state + PKCE doğrulayıcı şifreli, HttpOnly, 10 dk'lık çerezde tutulur; Google onay ekranına yönlendirir.
 */
export async function GET() {
  const actor = await getActorOrNull();
  if (!actor) return NextResponse.redirect(new URL("/giris", env().APP_URL));
  if (!actor.perms.has("integrations.manage")) return NextResponse.redirect(new URL("/yetkisiz", env().APP_URL));
  if (!googleClient()) return back("google=hata&neden=yapilandirilmadi");
  const { url, cookie } = startAuthorization(actor.id);
  const res = NextResponse.redirect(url, { headers: { "Cache-Control": "no-store" } });
  res.cookies.set(GOOGLE_STATE_COOKIE, cookie, { httpOnly: true, secure: env().APP_URL.startsWith("https://"), sameSite: "lax", path: "/api/v1/oauth/google", maxAge: 600 });
  return res;
}
