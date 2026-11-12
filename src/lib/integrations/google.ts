import "server-only";
import { createHash } from "node:crypto";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { decrypt, encrypt, randomToken } from "@/lib/crypto";
import { TokenError } from "./health";

/**
 * Google Takvim: OAuth 2.0 (yetkilendirme kodu + PKCE S256 + state). Yalnız `calendar.events` kapsamı istenir.
 * Yenileme anahtarı integration_credentials'ta DATA_ENCRYPTION_KEY ile şifreli durur; erişim anahtarı yalnız bellekte.
 */
export const GOOGLE_SCOPES = ["openid", "email", "https://www.googleapis.com/auth/calendar.events"];
const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.events";
export const GOOGLE_STATE_COOKIE = "bcrm_goauth";
const CREDENTIAL_KEY = "refresh_token";

function urls() {
  const e = env();
  const dev = e.APP_ENV !== "production";
  const oauth = (dev && e.GOOGLE_OAUTH_URL) || null;
  return {
    auth: oauth ? `${oauth}/auth` : "https://accounts.google.com/o/oauth2/v2/auth",
    token: oauth ? `${oauth}/token` : "https://oauth2.googleapis.com/token",
    revoke: oauth ? `${oauth}/revoke` : "https://oauth2.googleapis.com/revoke",
    api: ((dev && e.GOOGLE_API_URL) || "https://www.googleapis.com").replace(/\/$/, ""),
  };
}

export function googleClient() {
  const e = env();
  if (!e.GOOGLE_CLIENT_ID || !e.GOOGLE_CLIENT_SECRET) return null;
  return { clientId: e.GOOGLE_CLIENT_ID, clientSecret: e.GOOGLE_CLIENT_SECRET, redirectUri: `${e.APP_URL.replace(/\/$/, "")}/api/v1/oauth/google/callback` };
}

export type OAuthState = { state: string; verifier: string; userId: string; exp: number };

/** Yeni akış: state + PKCE doğrulayıcı (şifreli çerezde saklanır) ve Google onay adresi. */
export function startAuthorization(userId: string) {
  const client = googleClient();
  if (!client) throw new Error("GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET tanımlı değil.");
  const st: OAuthState = { state: randomToken(24), verifier: randomToken(48), userId, exp: Date.now() + 10 * 60_000 };
  const challenge = createHash("sha256").update(st.verifier).digest("base64url");
  const url = new URL(urls().auth);
  url.search = new URLSearchParams({
    client_id: client.clientId,
    redirect_uri: client.redirectUri,
    response_type: "code",
    scope: GOOGLE_SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state: st.state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  }).toString();
  return { url: url.toString(), cookie: encrypt(JSON.stringify(st), env().DATA_ENCRYPTION_KEY) };
}

export function readState(cookie: string | undefined): OAuthState | null {
  if (!cookie) return null;
  try {
    const s = JSON.parse(decrypt(cookie, env().DATA_ENCRYPTION_KEY)) as OAuthState;
    return s.exp > Date.now() ? s : null;
  } catch {
    return null;
  }
}

type TokenResponse = { access_token?: string; refresh_token?: string; expires_in?: number; scope?: string; id_token?: string; error?: string; error_description?: string };

async function tokenRequest(params: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(urls().token, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(params), signal: AbortSignal.timeout(15_000), cache: "no-store" });
  const json = (await res.json().catch(() => ({}))) as TokenResponse;
  if (!res.ok || json.error) {
    const msg = `Google token ${res.status}: ${json.error ?? "hata"}${json.error_description ? ` (${json.error_description.slice(0, 200)})` : ""}`;
    if (json.error === "invalid_grant" || json.error === "invalid_client" || json.error === "unauthorized_client") throw new TokenError(msg, "GOOGLE_CALENDAR");
    throw new Error(msg);
  }
  return json;
}

/** id_token doğrudan Google'ın token ucundan TLS ile geldiği için imza doğrulamadan yalnız e-posta okunur (yetki kararı için kullanılmaz). */
function emailFromIdToken(idToken: string | undefined) {
  try {
    const payload = JSON.parse(Buffer.from((idToken ?? "").split(".")[1] ?? "", "base64url").toString("utf8")) as { email?: string };
    return typeof payload.email === "string" ? payload.email.slice(0, 200) : null;
  } catch {
    return null;
  }
}

/** Callback: kodu PKCE doğrulayıcısıyla değiştirir, kapsamı ve yenileme anahtarını denetler, şifreli saklar. */
export async function completeAuthorization(code: string, verifier: string, actorId: string) {
  const client = googleClient();
  if (!client) throw new Error("Google istemcisi yapılandırılmadı.");
  const t = await tokenRequest({ grant_type: "authorization_code", code, code_verifier: verifier, client_id: client.clientId, client_secret: client.clientSecret, redirect_uri: client.redirectUri });
  if (!t.refresh_token) throw new Error("Google yenileme anahtarı vermedi (izin ekranında erişim onaylanmamış olabilir).");
  if (!(t.scope ?? "").split(" ").includes(CALENDAR_SCOPE)) throw new Error("Takvim izni verilmedi; bağlantı kurulmadı.");
  const accountEmail = emailFromIdToken(t.id_token);
  await prisma.integrationCredential.upsert({
    where: { provider_key: { provider: "GOOGLE_CALENDAR", key: CREDENTIAL_KEY } },
    create: { provider: "GOOGLE_CALENDAR", key: CREDENTIAL_KEY, ciphertext: encrypt(t.refresh_token, env().DATA_ENCRYPTION_KEY), createdById: actorId },
    update: { ciphertext: encrypt(t.refresh_token, env().DATA_ENCRYPTION_KEY), createdById: actorId },
  });
  cache = t.access_token ? { token: t.access_token, exp: Date.now() + ((t.expires_in ?? 3600) - 60) * 1000 } : null;
  return { accountEmail };
}

let cache: { token: string; exp: number } | null = null;

export async function hasGoogleCredential() {
  return Boolean(await prisma.integrationCredential.findUnique({ where: { provider_key: { provider: "GOOGLE_CALENDAR", key: CREDENTIAL_KEY } }, select: { id: true } }));
}

async function accessToken(force = false) {
  if (!force && cache && cache.exp > Date.now()) return cache.token;
  const client = googleClient();
  if (!client) throw new TokenError("GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET tanımlı değil.", "GOOGLE_CALENDAR");
  const cred = await prisma.integrationCredential.findUnique({ where: { provider_key: { provider: "GOOGLE_CALENDAR", key: CREDENTIAL_KEY } } });
  if (!cred) throw new TokenError("Google hesabı bağlı değil.", "GOOGLE_CALENDAR");
  const t = await tokenRequest({ grant_type: "refresh_token", refresh_token: decrypt(cred.ciphertext, env().DATA_ENCRYPTION_KEY), client_id: client.clientId, client_secret: client.clientSecret });
  if (!t.access_token) throw new Error("Google erişim anahtarı alınamadı.");
  cache = { token: t.access_token, exp: Date.now() + ((t.expires_in ?? 3600) - 60) * 1000 };
  return cache.token;
}

export class GoogleApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "GoogleApiError";
  }
}

/** Calendar API çağrısı; 401'de anahtar bir kez yenilenir, yine 401 ise TokenError (bağlantı "Hata"). */
export async function calendarRequest<T>(path: string, opts: { method?: "GET" | "POST" | "PATCH" | "DELETE"; body?: unknown; query?: Record<string, string> } = {}): Promise<T | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const url = new URL(`${urls().api}/calendar/v3/${path.replace(/^\//, "")}`);
    for (const [k, v] of Object.entries(opts.query ?? {})) url.searchParams.set(k, v);
    const res = await fetch(url, {
      method: opts.method ?? "GET",
      headers: { Authorization: `Bearer ${await accessToken(attempt > 0)}`, ...(opts.body ? { "Content-Type": "application/json" } : {}) },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      signal: AbortSignal.timeout(15_000),
      cache: "no-store",
    });
    if (res.status === 401 && attempt === 0) continue;
    if (res.status === 204) return null;
    const text = await res.text();
    if (!res.ok) {
      let msg = text.slice(0, 300);
      try {
        msg = (JSON.parse(text) as { error?: { message?: string } }).error?.message?.slice(0, 300) ?? msg;
      } catch {
        /* düz metin */
      }
      if (res.status === 401 || (res.status === 403 && /insufficient|scope|permission/i.test(msg))) throw new TokenError(`Google Takvim ${res.status}: ${msg}`, "GOOGLE_CALENDAR");
      throw new GoogleApiError(`Google Takvim ${res.status}: ${msg}`, res.status);
    }
    return text ? (JSON.parse(text) as T) : null;
  }
  throw new TokenError("Google Takvim yetkisi reddedildi.", "GOOGLE_CALENDAR");
}

/** Bağlantıyı kaldırır: Google'da anahtarı iptal etmeyi dener, yerel şifreli kaydı her durumda siler. */
export async function revokeGoogle() {
  const cred = await prisma.integrationCredential.findUnique({ where: { provider_key: { provider: "GOOGLE_CALENDAR", key: CREDENTIAL_KEY } } });
  if (cred) {
    try {
      await fetch(urls().revoke, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ token: decrypt(cred.ciphertext, env().DATA_ENCRYPTION_KEY) }), signal: AbortSignal.timeout(10_000) });
    } catch {
      /* iptal edilemese de yerel kayıt silinir */
    }
    await prisma.integrationCredential.delete({ where: { id: cred.id } });
  }
  cache = null;
}
