import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

/**
 * Veritabanı tabanlı dayanıklı iş kuyruğu.
 *  - claim: FOR UPDATE SKIP LOCKED → birden çok worker aynı işi almaz.
 *  - hata: üstel geri çekilme (30 sn × 2^n, en fazla 6 saat) + %20 sapma; maxAttempts aşılınca DEAD_LETTER.
 *  - kilitli kalan iş (worker çöktü): lockedAt 10 dk'dan eskiyse tekrar alınabilir.
 * Trafik büyürse aynı arayüzle Redis/BullMQ'ya taşınabilir.
 */
export type Job = { id: string; type: string; payload: Prisma.JsonValue; attempts: number; maxAttempts: number; eventId: string | null };

type Tx = Prisma.TransactionClient | typeof prisma;

export async function enqueue(type: string, payload: Prisma.InputJsonValue, opts: { runAt?: Date; maxAttempts?: number; eventId?: string } = {}, tx: Tx = prisma) {
  return tx.integrationJob.create({ data: { type, payload, runAt: opts.runAt ?? new Date(), maxAttempts: opts.maxAttempts ?? 8, eventId: opts.eventId ?? null } });
}

export function backoffMs(attempt: number, random = Math.random()) {
  const base = Math.min(30_000 * 2 ** Math.max(0, attempt - 1), 6 * 3600_000);
  return Math.round(base * (0.9 + random * 0.2));
}

export async function claimJobs(workerId: string, limit = 5): Promise<Job[]> {
  // UPDATE … RETURNING sıra garanti etmez → sonucu runAt'a göre sırala (aynı kişinin ardışık başvuruları sırayla işlensin).
  return prisma.$queryRaw<Job[]>`
    WITH claimed AS (
    UPDATE integration_jobs SET status = 'PROCESSING', "lockedAt" = now(), "lockedBy" = ${workerId}, attempts = attempts + 1, "updatedAt" = now()
    WHERE id IN (
      SELECT id FROM integration_jobs
      WHERE (status IN ('PENDING','RETRY') AND "runAt" <= now())
         OR (status = 'PROCESSING' AND "lockedAt" < now() - interval '10 minutes')
      ORDER BY "runAt"
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id, type, payload, attempts, "maxAttempts", "eventId"::text AS "eventId", "runAt", "createdAt"
    )
    SELECT id::text AS id, type, payload, attempts, "maxAttempts", "eventId" FROM claimed ORDER BY "runAt", "createdAt"`;
}

export async function completeJob(job: Job) {
  await prisma.integrationJob.update({ where: { id: job.id }, data: { status: "SUCCESS", completedAt: new Date(), lockedAt: null, lockedBy: null, lastError: null } });
}

export async function failJob(job: Job, error: unknown) {
  const message = (error instanceof Error ? error.message : String(error)).slice(0, 2000);
  const dead = job.attempts >= job.maxAttempts;
  await prisma.integrationJob.update({
    where: { id: job.id },
    data: {
      status: dead ? "DEAD_LETTER" : "RETRY",
      lastError: message,
      lockedAt: null,
      lockedBy: null,
      runAt: dead ? undefined : new Date(Date.now() + backoffMs(job.attempts)),
    },
  });
  return dead ? "DEAD_LETTER" : "RETRY";
}

/** Yönetici "yeniden dene": dead-letter/failed işi hemen tekrar sıraya alır (deneme sayacı sıfırlanır). */
export async function retryJobNow(id: string) {
  return prisma.integrationJob.update({ where: { id }, data: { status: "PENDING", runAt: new Date(), attempts: 0, lastError: null, lockedAt: null, lockedBy: null } });
}
