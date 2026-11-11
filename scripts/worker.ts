/**
 * Bifire CRM arka plan işçisi (PM2: bifire-crm-worker). Web sürecinden AYRI çalışır.
 * Çalıştırma: npm run worker  (tsx --conditions=react-server)
 *            npm run worker -- --once  (tek tur: tarama + kuyruk; cron/test için)
 *  - integration_jobs kuyruğunu işler (retry / dead-letter).
 *  - Dakikada bir görev hatırlatma / gecikme / eskalasyon taraması.
 */
import "dotenv/config";
import { hostname } from "node:os";
import { prisma } from "@/lib/db";
import { claimJobs, completeJob, failJob, type Job } from "@/lib/jobs/queue";
import { runReminderScan } from "@/lib/jobs/reminders";
import { ingestWebsiteEvent, markWebsiteEventFailed } from "@/lib/services/website-intake";

const WORKER_ID = `${hostname()}:${process.pid}`;
let stopping = false;

/** İş türü → işleyici. */
const handlers: Record<string, (job: Job) => Promise<void>> = {
  "system.reminder_scan": async () => {
    await runReminderScan();
  },
  /** Site formu → müşteri/fırsat/görev (src/app/api/v1/intake/website). */
  "website.ingest": async (job) => {
    const eventId = (job.payload as { eventId?: string } | null)?.eventId;
    if (!eventId) throw new Error("website.ingest: eventId yok");
    const r = await ingestWebsiteEvent(eventId);
    console.log(`[worker] website.ingest ${eventId} → ${r.outcome}`);
  },
};

/** Süresi geçmiş nonce kayıtlarını temizler (tekrar koruması penceresi dışında kalanlar). */
async function pruneNonces() {
  await prisma.webhookNonce.deleteMany({ where: { expiresAt: { lt: new Date() } } });
}

async function processBatch() {
  const jobs = await claimJobs(WORKER_ID, 5);
  for (const job of jobs) {
    const handler = handlers[job.type];
    try {
      if (!handler) throw new Error(`Bilinmeyen iş türü: ${job.type}`);
      await handler(job);
      await completeJob(job);
    } catch (e) {
      const result = await failJob(job, e);
      if (job.type === "website.ingest" && job.eventId) await markWebsiteEventFailed(job.eventId, e instanceof Error ? e.message : String(e), result === "DEAD_LETTER");
      console.error(`[worker] ${job.type} ${job.id} hata (${result}):`, e instanceof Error ? e.message : e);
    }
  }
  return jobs.length;
}

async function main() {
  console.log(`[worker] başladı ${WORKER_ID}`);
  if (process.argv.includes("--once")) {
    const r = await runReminderScan();
    await pruneNonces();
    const n = await processBatch();
    console.log(`[worker] tek tur: hatırlatma=${r.reminded} gecikme=${r.overdue} eskalasyon=${r.escalated} iş=${n}`);
    await prisma.$disconnect();
    return;
  }
  let lastScan = 0;
  while (!stopping) {
    try {
      if (Date.now() - lastScan > 60_000) {
        lastScan = Date.now();
        await pruneNonces();
        const r = await runReminderScan();
        if (r.reminded || r.escalated) console.log(`[worker] hatırlatma=${r.reminded} gecikme=${r.overdue} eskalasyon=${r.escalated}`);
      }
      const n = await processBatch();
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
