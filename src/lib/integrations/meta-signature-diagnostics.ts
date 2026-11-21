import "server-only";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse as parseDotenv } from "dotenv";

/**
 * GEÇİCİ TANILAMA — Meta webhook imzası doğrulanamadığında NEDENİNİ anlamak için tek satır log üretir.
 * Yalnız imza başarısız olduğunda çağrılır; doğrulamayı değiştirmez (istek yine 401 ile reddedilir).
 *
 * ASLA loglanmaz: uygulama sırrı, erişim token'ı, imza değeri, gövde/mesaj içeriği, kişi/hesap kimlikleri.
 * Loglanan: başlık var mı / biçimi doğru mu, gövde byte uzunluğu, sırrın BİÇİMİ (uzunluk, hex mi, boşluk/tırnak var mı),
 * sırrın hangi .env dosyalarında tanımlı olduğu ve çalışan süreçteki değerle AYNI olup olmadığı (yalnız evet/hayır),
 * yükün yalnız yapısal adları (object, alan adları, kayıt sayısı).
 *
 * Kaldırmak için: bu dosyayı ve route.ts'teki tek çağrıyı silin; doğrulama davranışı değişmez.
 */

const ENV_FILES = [".env.production.local", ".env.local", ".env.production", ".env"] as const;
const MAX_LOGS_PER_PROCESS = 200;
let logged = 0;

export type SignatureDiagnostics = ReturnType<typeof describeSignatureFailure>;

/** Sırrın hangi dosyada tanımlandığı + çalışan değerle eşit olup olmadığı (değer döndürülmez). */
export function secretSources(runtimeValue: string | undefined, cwd = process.cwd()) {
  return ENV_FILES.map((file) => {
    const path = join(cwd, file);
    if (!existsSync(path)) return { file, exists: false, defines: false, matchesRuntime: false };
    try {
      const v = parseDotenv(readFileSync(path)).META_APP_SECRET;
      return { file, exists: true, defines: v !== undefined && v !== "", matchesRuntime: v !== undefined && v === runtimeValue };
    } catch {
      return { file, exists: true, defines: false, matchesRuntime: false, unreadable: true };
    }
  });
}

function payloadShape(rawBody: string, instagramAccountId: string | undefined) {
  try {
    const b = JSON.parse(rawBody) as { object?: unknown; entry?: unknown };
    const entries = Array.isArray(b.entry) ? (b.entry as Record<string, unknown>[]) : [];
    const fields = new Set<string>();
    for (const e of entries.slice(0, 20)) {
      if (Array.isArray(e.changes)) for (const c of e.changes as { field?: unknown }[]) if (typeof c.field === "string") fields.add(c.field.slice(0, 40));
      if (Array.isArray(e.messaging)) fields.add("messaging[]");
    }
    return {
      json: true,
      object: typeof b.object === "string" ? b.object.slice(0, 40) : null,
      fields: [...fields].slice(0, 10),
      entryCount: entries.length,
      // Hesap kimliği loglanmaz; yalnız yapılandırılan Instagram hesabına ait olup olmadığı.
      entryIsConfiguredInstagramAccount: instagramAccountId ? entries.some((e) => String(e.id ?? "") === instagramAccountId) : null,
    };
  } catch {
    return { json: false };
  }
}

export function describeSignatureFailure(input: {
  rawBody: string;
  headers: Headers;
  secret: string;
  runtimeSecret: string | undefined;
  instagramAccountId?: string;
  cwd?: string;
}) {
  const h = input.headers.get("x-hub-signature-256");
  const cl = input.headers.get("content-length");
  const bodyBytes = Buffer.byteLength(input.rawBody, "utf8");
  const sources = secretSources(input.runtimeSecret, input.cwd);
  const s = input.secret;
  return {
    tag: "meta-webhook-signature-diagnostic",
    verified: false,
    header: {
      present: h !== null,
      prefix: h === null ? null : /^sha256=/i.test(h) ? "sha256=" : /^sha1=/i.test(h) ? "sha1=" : "other",
      formatOk: h !== null && /^sha256=[0-9a-f]{64}$/.test(h),
      // Büyük harfli hex de geçersiz sayılır; tanı için ayrıca belirtilir.
      upperCaseHex: h !== null && /^sha256=[0-9A-F]{64}$/.test(h) && /[A-F]/.test(h),
      legacySha1Present: input.headers.has("x-hub-signature"),
    },
    body: {
      bytes: bodyBytes,
      contentLength: cl === null ? null : Number(cl),
      contentLengthMatches: cl === null ? null : Number(cl) === bodyBytes,
      contentEncoding: input.headers.get("content-encoding"),
      // Meta yükü ASCII'dir (\uXXXX kaçışlı). Ham ASCII dışı karakter varsa gövde yolda değiştirilmiş olabilir.
      hasNonAscii: /[^\x00-\x7f]/.test(input.rawBody),
      ...payloadShape(input.rawBody, input.instagramAccountId),
    },
    secret: {
      length: s.length,
      // Meta App Secret normalde 32 karakter küçük harf hex'tir.
      looksLikeMetaAppSecret: /^[0-9a-f]{32}$/.test(s),
      hasOuterWhitespace: s !== s.trim(),
      hasQuotes: /^["']|["']$/.test(s),
    },
    secretSources: sources,
    // Hiçbir .env dosyası çalışan değeri vermiyorsa değer süreç ortamından (pm2 / export) geliyordur.
    runtimeValueFromEnvFile: sources.some((x) => x.matchesRuntime),
    userAgent: (input.headers.get("user-agent") ?? "").slice(0, 60),
  };
}

/** İmza başarısızlığında tek satır JSON log (süreç başına en fazla 200 satır). Hata atmaz. */
export function logSignatureFailure(input: Parameters<typeof describeSignatureFailure>[0]) {
  if (logged >= MAX_LOGS_PER_PROCESS) return;
  logged++;
  try {
    console.warn(JSON.stringify(describeSignatureFailure(input)));
  } catch {
    // Tanılama hiçbir koşulda isteği etkilemez.
  }
}
