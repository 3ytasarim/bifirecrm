import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/lib/env";
import { safeEqual } from "@/lib/crypto";
import { getActorOrNull } from "@/lib/rbac/guard";
import { audit } from "@/lib/audit";
import { GOOGLE_STATE_COOKIE, readState } from "@/lib/integrations/google";
import { connectGoogleCalendar } from "@/lib/services/calendar-sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/v1/oauth/google/callback — Google dönüşü. Kabul koşulları: oturum + integrations.manage,
 * çerezdeki state ile eşleşen state (sabit zamanlı karşılaştırma), akışı başlatan kullanıcıyla aynı kişi,
 * süresi dolmamış çerez. Kod, çerezdeki PKCE doğrulayıcısıyla değiştirilir; çerez her durumda silinir.
 */
export async function GET(req: NextRequest) {
  const done = (q: string) => {
    const res = NextResponse.redirect(new URL(`/entegrasyonlar?${q}`, env().APP_URL), { headers: { "Cache-Control": "no-store" } });
    res.cookies.set(GOOGLE_STATE_COOKIE, "", { httpOnly: true, secure: env().APP_URL.startsWith("https://"), sameSite: "lax", path: "/api/v1/oauth/google", maxAge: 0 });
    return res;
  };
  const actor = await getActorOrNull();
  if (!actor) return NextResponse.redirect(new URL("/giris", env().APP_URL));
  if (!actor.perms.has("integrations.manage")) return done("google=hata&neden=yetki");

  const q = req.nextUrl.searchParams;
  const st = readState(req.cookies.get(GOOGLE_STATE_COOKIE)?.value);
  const state = q.get("state") ?? "";
  if (!st || !state || !safeEqual(state, st.state) || st.userId !== actor.id) {
    await audit({ actorId: actor.id, action: "google_calendar_connect_failed", entityType: "integration", entityId: "GOOGLE_CALENDAR", summary: "state doğrulanamadı" });
    return done("google=hata&neden=durum");
  }
  if (q.get("error")) return done(`google=hata&neden=${q.get("error") === "access_denied" ? "reddedildi" : "google"}`);
  const code = q.get("code");
  if (!code || code.length > 2048) return done("google=hata&neden=kod");
  try {
    await connectGoogleCalendar(actor, code, st.verifier);
    return done("google=baglandi");
  } catch (e) {
    console.error("[oauth/google] bağlantı hatası:", e instanceof Error ? e.message : "bilinmeyen");
    await audit({ actorId: actor.id, action: "google_calendar_connect_failed", entityType: "integration", entityId: "GOOGLE_CALENDAR", summary: (e instanceof Error ? e.message : "hata").slice(0, 300) });
    return done("google=hata&neden=degisim");
  }
}
