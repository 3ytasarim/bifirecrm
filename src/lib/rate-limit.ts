import "server-only";
import { prisma } from "@/lib/db";

/**
 * DB tabanlı sabit pencere hız sınırı (PM2 cluster / birden çok process'te de tutarlı).
 * Tek atomik UPSERT: pencere dolmuşsa sayaç sıfırlanır.
 */
export async function rateLimit(key: string, limit: number, windowSec: number): Promise<{ ok: boolean; remaining: number; resetAt: Date }> {
  const rows = await prisma.$queryRaw<{ count: number; resetAt: Date }[]>`
    INSERT INTO rate_limit_buckets ("key", "count", "resetAt")
    VALUES (${key}, 1, now() + make_interval(secs => ${windowSec}))
    ON CONFLICT ("key") DO UPDATE SET
      "count" = CASE WHEN rate_limit_buckets."resetAt" < now() THEN 1 ELSE rate_limit_buckets."count" + 1 END,
      "resetAt" = CASE WHEN rate_limit_buckets."resetAt" < now() THEN now() + make_interval(secs => ${windowSec}) ELSE rate_limit_buckets."resetAt" END
    RETURNING "count", "resetAt"`;
  const row = rows[0];
  return { ok: row.count <= limit, remaining: Math.max(0, limit - row.count), resetAt: row.resetAt };
}
