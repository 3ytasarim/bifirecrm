import { revalidatePath } from "next/cache";
import type { IntegrationProvider, JobStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { audit } from "@/lib/audit";
import { assertCan, getActorOrNull, requirePermission } from "@/lib/rbac/guard";
import { retryJobNow } from "@/lib/jobs/queue";
import { CONNECTION_STATUS_LABELS, JOB_STATUS_LABELS, PROVIDER_LABELS } from "@/lib/labels";
import { fmtDateTime, fmtRelative } from "@/lib/format";
import { Badge, Card, EmptyState, PageHeader, Stat, tableCls } from "@/components/ui/primitives";
import { buttonClass } from "@/components/ui/styles";

export const metadata = { title: "Entegrasyonlar" };

/** Her sağlayıcı için gerçekte ne gerektiği; bağlantı yoksa "bağlı" gösterilmez. */
const REQUIREMENTS: Record<IntegrationProvider, { phase: string; needs: string }> = {
  BIFIRE_WEBSITE: { phase: "Faz 2", needs: "Sitede CRM_FORWARD_ENABLED=true + aynı HMAC sırrı (CRM: WEBSITE_HMAC_SECRET, site: CRM_WEBSITE_HMAC_SECRET). İlk imzalı başvuru gelince “Aktif” olur." },
  META_LEAD_ADS: { phase: "Faz 4", needs: "Bifire Business Manager, sayfa erişimi, Meta uygulaması + App Review, leadgen webhook." },
  WHATSAPP: { phase: "Faz 5", needs: "WhatsApp Business Platform hesabı, numara doğrulama, onaylı şablonlar, opt-in takibi." },
  INSTAGRAM_DM: { phase: "Faz 5", needs: "Instagram işletme hesabı, Meta mesajlaşma izinleri ve App Review." },
  SMTP: { phase: "Faz 1 (opsiyonel)", needs: "SMTP_URL ve SMTP_FROM .env'e eklenince ekip bildirim e-postaları açılır." },
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

export default async function IntegrationsPage() {
  const actor = await requirePermission("integrations.view");
  const [connections, jobs, counts, events] = await Promise.all([
    prisma.integrationConnection.findMany(),
    prisma.integrationJob.findMany({ where: { NOT: { type: "system.reminder_scan" } }, orderBy: { updatedAt: "desc" }, take: 50 }),
    prisma.integrationJob.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.integrationEvent.findMany({ orderBy: { receivedAt: "desc" }, take: 30 }),
  ]);
  const count = (s: JobStatus) => counts.find((c) => c.status === s)?._count._all ?? 0;
  const smtp = Boolean(process.env.SMTP_URL && process.env.SMTP_FROM);

  return (
    <>
      <PageHeader title="Entegrasyonlar / Aktarım günlüğü" description="Dış kaynaklardan veri alımı, yeniden deneme ve kalıcı hata kuyruğu. Hesabı bağlanmamış kanal “aktif” gösterilmez." />
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
            const status = p === "SMTP" ? (smtp ? "ACTIVE" : "NOT_CONFIGURED") : (c?.status ?? "NOT_CONFIGURED");
            return (
              <li key={p} className="flex flex-wrap items-start justify-between gap-3 px-5 py-4">
                <div className="min-w-0 max-w-2xl">
                  <p className="font-medium">{PROVIDER_LABELS[p]}</p>
                  <p className="mt-0.5 text-xs text-muted">
                    {REQUIREMENTS[p].phase} · {REQUIREMENTS[p].needs}
                  </p>
                  {c?.lastError ? <p className="mt-1 text-xs text-danger">Son hata ({fmtDateTime(c.lastErrorAt)}): {c.lastError}</p> : null}
                </div>
                <div className="text-right text-xs">
                  <Badge tone={status === "ACTIVE" ? "success" : status === "ERROR" ? "danger" : "neutral"}>{CONNECTION_STATUS_LABELS[status]}</Badge>
                  <p className="mt-1 text-muted">Son senkron: {c?.lastSyncAt ? fmtRelative(c.lastSyncAt) : "—"}</p>
                </div>
              </li>
            );
          })}
        </ul>
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
                        {(j.status === "DEAD_LETTER" || j.status === "FAILED" || j.status === "RETRY") && actor.perms.has("integrations.manage") ? (
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
            <EmptyState title="Kuyrukta entegrasyon işi yok" description="Siteden başvuru geldikçe her aktarım burada izlenir." />
          )}
        </Card>
        <Card title="Gelen olaylar (son 30)" padded={false}>
          {events.length ? (
            <ul className="divide-y divide-line">
              {events.map((e) => (
                <li key={e.id} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
                  <span>
                    {PROVIDER_LABELS[e.provider]} · <span className="font-mono text-xs">{e.eventType}</span>
                    <span className="block text-xs text-muted">{fmtDateTime(e.receivedAt)}</span>
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
