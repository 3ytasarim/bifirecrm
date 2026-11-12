/**
 * Bifire CRM arka plan işçisi (PM2: bifire-crm-worker). Web sürecinden AYRI çalışır.
 * Çalıştırma: npm run worker  (tsx --conditions=react-server)
 *            npm run worker -- --once  (tek tur: tarama + kuyruk; cron/test için)
 *  - integration_jobs kuyruğunu işler (retry / dead-letter) — işleyiciler: src/lib/jobs/handlers.ts.
 *  - Dakikada bir görev hatırlatma / gecikme / eskalasyon taraması.
 *  - 2 dakikada bir site formlarını çekme (WEBSITE_PULL_URL tanımlıysa; src/lib/integrations/website-pull.ts).
 *  - Saatte bir kanal sağlık kontrolü (Meta / WhatsApp / Google anahtarları gerçek çağrıyla denenir).
 */
import "dotenv/config";
import { hostname } from "node:os";
import { prisma } from "@/lib/db";
import { runReminderScan } from "@/lib/jobs/reminders";
import { handlers, processBatch } from "@/lib/jobs/handlers";
import { pullWebsiteRequests } from "@/lib/integrations/website-pull";

const WORKER_ID = `${hostname()}:${process.pid}`;
let stopping = false;

/** Süresi geçmiş nonce kayıtlarını temizler (tekrar koruması penceresi dışında kalanlar). */
async function pruneNonces() {
  await prisma.webhookNonce.deleteMany({ where: { expiresAt: { lt: new Date() } } });
}

async function healthCheck() {
  try {
    const r = await handlers["integrations.health_check"]({ id: "health", type: "integrations.health_check", payload: null, attempts: 1, maxAttempts: 1, eventId: null });
    console.log(`[worker] sağlık kontrolü ${JSON.stringify(r)}`);
  } catch (e) {
    console.error("[worker] sağlık kontrolü hatası:", e instanceof Error ? e.message : e);
  }
}

/** Site formlarını çeker (WEBSITE_PULL_URL tanımlıysa). Sonuç kısaca loglanır, kişisel veri yok. */
async function websitePull() {
  const r = await pullWebsiteRequests();
  if (!r.enabled) return;
  if (r.error || r.imported || r.invalid) console.log(`[worker] site çekme: yeni=${r.imported} tekrar=${r.duplicates} geçersiz=${r.invalid}${r.error ? ` hata=${r.error}` : ""}`);
}

async function main() {
  console.log(`[worker] başladı ${WORKER_ID}`);
  if (process.argv.includes("--once")) {
    const r = await runReminderScan();
    await pruneNonces();
    await websitePull();
    const n = await processBatch(WORKER_ID, 20);
    console.log(`[worker] tek tur: hatırlatma=${r.reminded} gecikme=${r.overdue} eskalasyon=${r.escalated} iş=${n}`);
    await prisma.$disconnect();
    return;
  }
  let lastScan = 0;
  let lastHealth = 0;
  let lastPull = 0;
  while (!stopping) {
    try {
      if (Date.now() - lastScan > 60_000) {
        lastScan = Date.now();
        await pruneNonces();
        const r = await runReminderScan();
        if (r.reminded || r.escalated) console.log(`[worker] hatırlatma=${r.reminded} gecikme=${r.overdue} eskalasyon=${r.escalated}`);
      }
      if (Date.now() - lastPull > 120_000) {
        lastPull = Date.now();
        await websitePull();
      }
      if (Date.now() - lastHealth > 3600_000) {
        lastHealth = Date.now();
        await healthCheck();
      }
      const n = await processBatch(WORKER_ID, 5);
      if (n === 0) await new Promise((r) => setTimeout(r, 3000));
    } catch (e) {
      console.error("[worker] döngü hatası:", e instanceof Error ? e.message : e);
      await new Promise((r) => setTimeout(r, 10_000));
    }
  }
  await prisma.$disconnect();
  console.log("[worker] durdu");
}

for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => (stopping = true));
main();
