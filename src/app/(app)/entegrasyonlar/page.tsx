import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { IntegrationProvider, JobStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { audit } from "@/lib/audit";
import { RuleError } from "@/lib/errors";
import { assertCan, getActorOrNull, requirePermission } from "@/lib/rbac/guard";
import { retryJobNow } from "@/lib/jobs/queue";
import { missingEnv, REQUIRED_ENV } from "@/lib/integrations/channels-config";
import { requestTemplateSync } from "@/lib/services/channels";
import { disconnectGoogleCalendar } from "@/lib/services/calendar-sync";
import { CONNECTION_STATUS_LABELS, JOB_STATUS_LABELS, PROVIDER_LABELS, WA_TEMPLATE_CATEGORY_LABELS } from "@/lib/labels";
import { fmtDateTime, fmtRelative } from "@/lib/format";
import { Badge, Card, EmptyState, PageHeader, Stat, tableCls } from "@/components/ui/primitives";
import { buttonClass } from "@/components/ui/styles";

export const metadata = { title: "Entegrasyonlar" };

/** Her sağlayıcı için gerçekte ne gerektiği; bağlantı yoksa "bağlı" gösterilmez. */
const REQUIREMENTS: Record<IntegrationProvider, { phase: string; needs: string }> = {
  BIFIRE_WEBSITE: { phase: "Faz 2", needs: "Sitede CRM_FORWARD_ENABLED=true + aynı HMAC sırrı (CRM: WEBSITE_HMAC_SECRET, site: CRM_WEBSITE_HMAC_SECRET). İlk imzalı başvuru gelince “Aktif” olur." },
  META_LEAD_ADS: { phase: "Faz 4", needs: "Meta Business Manager, Facebook sayfası, Meta uygulaması (leads_retrieval + pages_manage_metadata, App Review), sayfaya leadgen webhook aboneliği, sistem kullanıcısı erişim anahtarı." },
  INSTAGRAM_DM: { phase: "Faz 4", needs: "Instagram profesyonel hesabı (sayfaya bağlı), instagram_manage_messages izni + App Review, messages webhook aboneliği. CRM gelen mesajı gösterir; yanıt Instagram uygulamasından verilir." },
  WHATSAPP: { phase: "Faz 4", needs: "WhatsApp Business hesabı (WABA), CRM için AYRI doğrulanmış numara, sistem kullanıcısı anahtarı (whatsapp_business_messaging), Meta'da onaylı şablonlar, messages webhook aboneliği." },
  GOOGLE_CALENDAR: { phase: "Faz 4", needs: "Google Cloud OAuth istemcisi (Web uygulaması), yönlendirme adresi bu sayfada; ardından “Google ile bağlan”. Randevular tek yönlü (CRM → Google) yazılır." },
  SMTP: { phase: "Faz 1 (opsiyonel)", needs: "SMTP_URL ve SMTP_FROM .env'e eklenince ekip bildirim e-postaları açılır." },
};

const GOOGLE_MESSAGES: Record<string, string> = {
  baglandi: "Google Takvim bağlandı; ileri tarihli randevular senkron kuyruğuna alındı.",
  kaldirildi: "Google Takvim bağlantısı kaldırıldı.",
  yapilandirilmadi: "GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET tanımlı değil.",
  yetki: "Bu işlem için yetkiniz yok.",
  durum: "Güvenlik doğrulaması (state) başarısız; işlemi yeniden başlatın.",
  reddedildi: "Google izin ekranında erişim reddedildi.",
  kod: "Google yetkilendirme kodu alınamadı.",
  degisim: "Google bağlantısı kurulamadı (kod değişimi ya da takvim izni). Ayrıntı denetim kaydında.",
  google: "Google bir hata döndürdü.",
};

async function retry(fd: FormData) {
  "use server";
  const actor = await getActorOrNull();
  if (!actor) return;
  assertCan(actor, "integrations.manage");
  const id = String(fd.get("id"));
  await retryJobNow(id);
  await audit({ actorId: actor.id, action: "integration_retry", entityType: "integration_job", entityId: id });
  revalidatePath("/entegrasyonlar");
}

async function syncTemplates() {
  "use server";
  const actor = await getActorOrNull();
  if (!actor) return;
  let q = "wa=sira";
  try {
    await requestTemplateSync(actor);
  } catch (e) {
    q = e instanceof RuleError ? "wa=yapilandirilmadi" : "wa=hata";
  }
  redirect(`/entegrasyonlar?${q}`);
}

async function disconnectGoogle() {
  "use server";
  const actor = await getActorOrNull();
  if (!actor) return;
  await disconnectGoogleCalendar(actor).catch(() => {});
  redirect("/entegrasyonlar?google=kaldirildi");
}

type SP = { google?: string; neden?: string; wa?: string };

export default async function IntegrationsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const actor = await requirePermission("integrations.view");
  const sp = await searchParams;
  const [connections, jobs, counts, events, templates, googleCred] = await Promise.all([
    prisma.integrationConnection.findMany(),
    prisma.integrationJob.findMany({ where: { NOT: { type: { in: ["system.reminder_scan", "integrations.health_check"] } } }, orderBy: { updatedAt: "desc" }, take: 50 }),
    prisma.integrationJob.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.integrationEvent.findMany({ orderBy: { receivedAt: "desc" }, take: 30, select: { id: true, provider: true, eventType: true, status: true, receivedAt: true, lastError: true } }),
    prisma.whatsappTemplate.findMany({ orderBy: [{ status: "asc" }, { name: "asc" }], take: 200 }),
    prisma.integrationCredential.findUnique({ where: { provider_key: { provider: "GOOGLE_CALENDAR", key: "refresh_token" } }, select: { createdAt: true } }),
  ]);
  const count = (s: JobStatus) => counts.find((c) => c.status === s)?._count._all ?? 0;
  const smtp = Boolean(process.env.SMTP_URL && process.env.SMTP_FROM);
  const canManage = actor.perms.has("integrations.manage");
  const appUrl = env().APP_URL.replace(/\/$/, "");
  const googleMsg = sp.google === "baglandi" || sp.google === "kaldirildi" ? GOOGLE_MESSAGES[sp.google] : sp.google === "hata" ? (GOOGLE_MESSAGES[sp.neden ?? ""] ?? GOOGLE_MESSAGES.google) : null;
  const waMsg = sp.wa === "sira" ? "Şablon senkronu kuyruğa alındı; worker birkaç saniye içinde Meta'dan çeker." : sp.wa === "yapilandirilmadi" ? "WhatsApp anahtarları .env'de tanımlı değil." : sp.wa === "hata" ? "Şablon senkronu başlatılamadı." : null;

  const extra = (p: IntegrationProvider) => {
    const cfg = (connections.find((x) => x.provider === p)?.config ?? {}) as Record<string, string | null>;
    if (p === "META_LEAD_ADS" || p === "INSTAGRAM_DM" || p === "WHATSAPP") {
      return (
        <p className="mt-1 text-xs text-muted">
          Webhook adresi: <code className="rounded bg-surface-2 px-1 font-mono">{appUrl}/api/v1/webhooks/meta</code> · doğrulama anahtarı: <code className="font-mono">META_VERIFY_TOKEN</code>
          {p === "WHATSAPP" && cfg.displayPhone ? (
            <span className="block">
              Numara: {cfg.displayPhone}
              {cfg.verifiedName ? ` · ${cfg.verifiedName}` : ""}
              {cfg.quality ? ` · kalite: ${cfg.quality}` : ""}
            </span>
          ) : null}
        </p>
      );
    }
    if (p === "GOOGLE_CALENDAR") {
      return (
        <div className="mt-1 text-xs text-muted">
          <p>
            Yönlendirme adresi (Google Cloud&apos;a eklenir): <code className="rounded bg-surface-2 px-1 font-mono">{appUrl}/api/v1/oauth/google/callback</code>
          </p>
          {googleCred ? <p className="mt-0.5">Bağlı hesap: {cfg.accountEmail ?? "bilinmiyor"} · takvim: {cfg.calendarId ?? "primary"}</p> : null}
          {canManage ? (
            <div className="mt-2 flex gap-2">
              {googleCred ? (
                <form action={disconnectGoogle}>
                  <button className={buttonClass("secondary", "sm")}>Bağlantıyı kaldır</button>
                </form>
              ) : missingEnv("GOOGLE_CALENDAR").length === 0 ? (
                // OAuth başlangıcı tam sayfa yönlendirmedir (Google onay ekranı); Link ön-yüklemesi istenmez.
                <a href="/api/v1/oauth/google/start" className={buttonClass("primary", "sm")}>
                  Google ile bağlan
                </a>
              ) : null}
            </div>
          ) : null}
        </div>
      );
    }
    return null;
  };

  return (
    <>
      <PageHeader title="Entegrasyonlar / Aktarım günlüğü" description="Dış kaynaklardan veri alımı, yeniden deneme ve kalıcı hata kuyruğu. Hesabı bağlanmamış kanal “aktif” gösterilmez; durum yalnız gerçek API yanıtı ya da imzası doğrulanmış olaydan gelir." />
      {googleMsg ? <p className={`mb-4 rounded-lg border px-4 py-3 text-sm ${sp.google === "hata" ? "border-danger/40 text-danger" : "border-line"}`} role="status">{googleMsg}</p> : null}
      {waMsg ? <p className={`mb-4 rounded-lg border px-4 py-3 text-sm ${sp.wa === "sira" ? "border-line" : "border-danger/40 text-danger"}`} role="status">{waMsg}</p> : null}
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Bekleyen / yeniden denenecek" value={count("PENDING") + count("RETRY")} />
        <Stat label="İşleniyor" value={count("PROCESSING")} />
        <Stat label="Başarılı" value={count("SUCCESS")} />
        <Stat label="Kalıcı hata (dead-letter)" value={count("DEAD_LETTER") + count("FAILED")} tone={count("DEAD_LETTER") + count("FAILED") ? "danger" : undefined} />
      </div>
      <Card title="Kanallar" padded={false} className="mb-6">
        <ul className="divide-y divide-line">
          {(Object.keys(PROVIDER_LABELS) as IntegrationProvider[]).map((p) => {
            const c = connections.find((x) => x.provider === p);
            const missing = REQUIRED_ENV[p] ? missingEnv(p) : [];
            const status = p === "SMTP" ? (smtp ? "ACTIVE" : "NOT_CONFIGURED") : p === "GOOGLE_CALENDAR" && !googleCred ? "NOT_CONFIGURED" : (c?.status ?? "NOT_CONFIGURED");
            return (
              <li key={p} className="flex flex-wrap items-start justify-between gap-3 px-5 py-4">
                <div className="min-w-0 max-w-3xl">
                  <p className="font-medium">{PROVIDER_LABELS[p]}</p>
                  <p className="mt-0.5 text-xs text-muted">
                    {REQUIREMENTS[p].phase} · {REQUIREMENTS[p].needs}
                  </p>
                  {missing.length ? (
                    <p className="mt-1 text-xs text-muted">
                      .env&apos;de eksik: {missing.map((k) => <code key={k} className="mr-1 rounded bg-surface-2 px-1 font-mono">{k}</code>)}
                    </p>
                  ) : null}
                  {extra(p)}
                  {c?.lastError && status !== "ACTIVE" ? <p className="mt-1 text-xs text-danger">Son hata ({fmtDateTime(c.lastErrorAt)}): {c.lastError}</p> : null}
                </div>
                <div className="text-right text-xs">
                  <Badge tone={status === "ACTIVE" ? "success" : status === "ERROR" ? "danger" : "neutral"}>{CONNECTION_STATUS_LABELS[status]}</Badge>
                  {status === "NOT_CONFIGURED" && REQUIRED_ENV[p] && !missing.length && p !== "GOOGLE_CALENDAR" ? <p className="mt-1 text-muted">Anahtarlar var, henüz doğrulanmadı</p> : null}
                  <p className="mt-1 text-muted">Son senkron: {c?.lastSyncAt ? fmtRelative(c.lastSyncAt) : "—"}</p>
                </div>
              </li>
            );
          })}
        </ul>
      </Card>

      <Card
        title={`WhatsApp şablonları (${templates.length})`}
        padded={false}
        className="mb-6"
        actions={
          canManage ? (
            <form action={syncTemplates}>
              <button className={buttonClass("secondary", "sm")}>Meta&apos;dan senkronize et</button>
            </form>
          ) : null
        }
      >
        {templates.length ? (
          <div className={tableCls.wrap}>
            <table className={tableCls.table}>
              <thead>
                <tr>
                  <th className={tableCls.th}>Şablon</th>
                  <th className={tableCls.th}>Kategori</th>
                  <th className={tableCls.th}>Durum</th>
                  <th className={tableCls.th}>Değişken</th>
                  <th className={tableCls.th}>Senkron</th>
                </tr>
              </thead>
              <tbody>
                {templates.map((t) => (
                  <tr key={t.id} className={tableCls.row}>
                    <td className={tableCls.td}>
                      <span className="font-mono text-xs">{t.name}</span> <span className="text-xs text-muted">({t.language})</span>
                      <span className="block max-w-md truncate text-xs text-muted" title={t.body}>
                        {t.body}
                      </span>
                    </td>
                    <td className={`${tableCls.td} text-xs`}>{WA_TEMPLATE_CATEGORY_LABELS[t.category] ?? t.category}</td>
                    <td className={tableCls.td}>
                      <Badge tone={t.status === "APPROVED" ? "success" : t.status === "REJECTED" || t.status === "DELETED" || t.status === "DISABLED" ? "danger" : "neutral"}>{t.status}</Badge>
                    </td>
                    <td className={`${tableCls.td} text-xs`}>{t.paramCount < 0 ? <span className="text-danger">CRM&apos;den gönderilemez</span> : t.paramCount}</td>
                    <td className={`${tableCls.td} text-xs text-muted`}>{fmtRelative(t.syncedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState title="Şablon yok" description="Şablonlar Meta WhatsApp Yöneticisi'nde oluşturulur ve onaylanır; CRM yalnız onaylıları gönderir. Bağlantı kurulunca “Meta'dan senkronize et”." />
        )}
      </Card>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card title="İş kuyruğu (son 50)" padded={false}>
          {jobs.length ? (
            <div className={tableCls.wrap}>
              <table className={tableCls.table}>
                <thead>
                  <tr>
                    <th className={tableCls.th}>İş</th>
                    <th className={tableCls.th}>Durum</th>
                    <th className={tableCls.th}>Deneme</th>
                    <th className={tableCls.th}>Sonraki</th>
                    <th className={tableCls.th}></th>
                  </tr>
                </thead>
                <tbody>
                  {jobs.map((j) => (
                    <tr key={j.id} className={tableCls.row}>
                      <td className={tableCls.td}>
                        <span className="font-mono text-xs">{j.type}</span>
                        {j.lastError ? <span className="block max-w-xs truncate text-xs text-danger" title={j.lastError}>{j.lastError}</span> : null}
                      </td>
                      <td className={tableCls.td}>
                        <Badge tone={j.status === "SUCCESS" ? "success" : j.status === "DEAD_LETTER" || j.status === "FAILED" ? "danger" : j.status === "RETRY" ? "warning" : "neutral"}>{JOB_STATUS_LABELS[j.status]}</Badge>
                      </td>
                      <td className={`${tableCls.td} tabular text-xs`}>
                        {j.attempts}/{j.maxAttempts}
                      </td>
                      <td className={`${tableCls.td} text-xs text-muted`}>{j.status === "RETRY" || j.status === "PENDING" ? fmtRelative(j.runAt) : "—"}</td>
                      <td className={tableCls.td}>
                        {(j.status === "DEAD_LETTER" || j.status === "FAILED" || j.status === "RETRY") && canManage ? (
                          <form action={retry}>
                            <input type="hidden" name="id" value={j.id} />
                            <button className={buttonClass("secondary", "sm")}>Şimdi dene</button>
                          </form>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState title="Kuyrukta entegrasyon işi yok" description="Siteden ya da Meta'dan olay geldikçe her aktarım burada izlenir." />
          )}
        </Card>
        <Card title="Gelen olaylar (son 30)" padded={false}>
          {events.length ? (
            <ul className="divide-y divide-line">
              {events.map((e) => (
                <li key={e.id} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
                  <span className="min-w-0">
                    {PROVIDER_LABELS[e.provider]} · <span className="font-mono text-xs">{e.eventType}</span>
                    <span className="block text-xs text-muted">{fmtDateTime(e.receivedAt)}</span>
                    {e.lastError ? <span className="block max-w-sm truncate text-xs text-muted" title={e.lastError}>{e.lastError}</span> : null}
                  </span>
                  <Badge tone={e.status === "SUCCESS" ? "success" : e.status === "DEAD_LETTER" || e.status === "FAILED" ? "danger" : "neutral"}>{JOB_STATUS_LABELS[e.status]}</Badge>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="Henüz dış olay alınmadı" />
          )}
        </Card>
      </div>
    </>
  );
}
