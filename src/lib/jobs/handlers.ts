import { prisma } from "@/lib/db";
import { claimJobs, completeJob, failJob, type Job } from "./queue";
import { runReminderScan } from "./reminders";
import { ingestWebsiteEvent, markWebsiteEventFailed } from "@/lib/services/website-intake";
import { deliverWhatsappMessage, markEventFailed, markOutboundDead, metaHealthCheck, processInstagramMessage, processLeadgen, processWhatsappMessage, processWhatsappStatus, syncWhatsappTemplates } from "@/lib/services/channels";
import { googleHealthCheck, syncAppointmentToGoogle } from "@/lib/services/calendar-sync";

const eventIdOf = (job: Job) => {
  const id = (job.payload as { eventId?: string } | null)?.eventId;
  if (!id) throw new Error(`${job.type}: eventId yok`);
  return id;
};
const field = (job: Job, key: string) => {
  const v = (job.payload as Record<string, unknown> | null)?.[key];
  if (typeof v !== "string") throw new Error(`${job.type}: ${key} yok`);
  return v;
};

/** İş türü → işleyici. Worker ve QA betikleri aynı tabloyu kullanır. */
export const handlers: Record<string, (job: Job) => Promise<unknown>> = {
  "system.reminder_scan": () => runReminderScan(),
  /** Site formu → müşteri/fırsat/görev (src/app/api/v1/intake/website). */
  "website.ingest": (job) => ingestWebsiteEvent(eventIdOf(job)),
  /** Meta reklam formu: Graph API'den form yanıtı çekilir → talep. */
  "meta.leadgen": (job) => processLeadgen(eventIdOf(job)),
  "instagram.message": (job) => processInstagramMessage(eventIdOf(job)),
  "whatsapp.message": (job) => processWhatsappMessage(eventIdOf(job)),
  "whatsapp.status": (job) => processWhatsappStatus(eventIdOf(job), job.attempts),
  "whatsapp.sync_templates": async (job) => {
    const r = await syncWhatsappTemplates();
    if (job.eventId) await prisma.integrationEvent.update({ where: { id: job.eventId }, data: { status: "SUCCESS", processedAt: new Date() } });
    return r;
  },
  "whatsapp.send": (job) => deliverWhatsappMessage(field(job, "messageId")),
  "gcal.sync_appointment": (job) => syncAppointmentToGoogle(field(job, "appointmentId")),
  "integrations.health_check": async () => ({ meta: await metaHealthCheck(), google: await googleHealthCheck() }),
};

/** Kuyruktan iş alıp işler. Hata → retry/dead-letter; olay ve giden mesaj durumları da güncellenir. */
export async function processBatch(workerId: string, limit = 5, log = true) {
  const jobs = await claimJobs(workerId, limit);
  for (const job of jobs) {
    const handler = handlers[job.type];
    try {
      if (!handler) throw new Error(`Bilinmeyen iş türü: ${job.type}`);
      const r = await handler(job);
      await completeJob(job);
      if (log && job.type !== "system.reminder_scan") console.log(`[worker] ${job.type} ${job.id} → ${JSON.stringify(r ?? null)?.slice(0, 200)}`);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      const result = await failJob(job, e);
      const dead = result === "DEAD_LETTER";
      if (job.eventId) {
        if (job.type === "website.ingest") await markWebsiteEventFailed(job.eventId, message, dead);
        else await markEventFailed(job.eventId, message, dead);
      }
      if (dead && job.type === "whatsapp.send") await markOutboundDead(field(job, "messageId"), message);
      if (log) console.error(`[worker] ${job.type} ${job.id} hata (${result}):`, message);
    }
  }
  return jobs.length;
}
