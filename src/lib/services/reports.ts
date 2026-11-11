import "server-only";
import { Prisma, type LeadSource, type OpportunityStage, type QuoteStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { assertCan, type Actor } from "@/lib/rbac/assert";

/**
 * Satış raporları. Tanımlar (ekranda da yazılır):
 *  - Kohort: seçilen aralıkta OLUŞTURULAN, silinmemiş fırsatlar (isteğe bağlı sorumlu filtresi).
 *  - Kaynak / dönüşüm: kohortun kaynağa göre dağılımı; kazanılan = bugün "Kazanıldı" aşamasında olan.
 *  - Huni: kohorttan temas kurulan (temas aktivitesi ya da "Temas kuruldu" ve sonrası aşamaya geçmiş), teklif gönderilen, kazanılan.
 *  - Kayıp nedenleri: seçilen aralıkta KAYBEDİLEN fırsatlar (lostAt aralıkta), nedenine göre.
 *  - Aşama süreleri: aralıkta bir aşamaya GİRİLİP sonra çıkılmış geçişler; süre = girişten bir sonraki aşama değişikliğine kadar.
 *  - İlk temas süresi: kohortta fırsat oluşturulmasından ilk temas aktivitesine (arama, WhatsApp, e-posta, görüşme, ziyaret) kadar.
 *  - Teklifler: aralıkta oluşturulan, silinmemiş teklifler; durum ve para birimine göre adet/toplam.
 * Tüm tarihler Europe/Istanbul gününe göre: [başlangıç 00:00, bitiş+1 00:00).
 */
export type ReportFilter = { from: Date; to: Date; ownerId: string | null };

const CONTACT_ACTIVITY = Prisma.sql`('CALL','MEETING','SHOWROOM_VISIT','SITE_VISIT','WHATSAPP','INSTAGRAM','EMAIL')`;
const CONTACTED_STAGES = Prisma.sql`('CONTACTED','NEEDS_ASSESSMENT','SHOWROOM_OR_SURVEY','TECHNICAL_REVIEW','QUOTATION_PREPARING','QUOTATION_SENT','NEGOTIATION','WON')`;

const cohort = (f: ReportFilter) => Prisma.sql`o."deletedAt" IS NULL AND o."createdAt" >= ${f.from} AND o."createdAt" < ${f.to} ${f.ownerId ? Prisma.sql`AND o."ownerId" = ${f.ownerId}::uuid` : Prisma.empty}`;
const owner = (f: ReportFilter) => (f.ownerId ? Prisma.sql`AND o."ownerId" = ${f.ownerId}::uuid` : Prisma.empty);
const n = (v: bigint | number | null) => Number(v ?? 0);

export async function salesReport(actor: Actor, f: ReportFilter) {
  assertCan(actor, "reports.view");
  const [bySource, funnel, lost, stages, firstContact, quotes] = await Promise.all([
    prisma.$queryRaw<{ source: LeadSource; total: bigint; won: bigint; lost: bigint; open: bigint }[]>`
      SELECT o.source, count(*) AS total,
             count(*) FILTER (WHERE o.stage = 'WON') AS won,
             count(*) FILTER (WHERE o.stage = 'LOST') AS lost,
             count(*) FILTER (WHERE o.stage NOT IN ('WON','LOST')) AS open
      FROM opportunities o WHERE ${cohort(f)}
      GROUP BY o.source ORDER BY total DESC, o.source`,
    prisma.$queryRaw<{ total: bigint; contacted: bigint; quoted: bigint; won: bigint }[]>`
      SELECT count(*) AS total,
             count(*) FILTER (WHERE EXISTS (SELECT 1 FROM activities a WHERE a."opportunityId" = o.id AND a.type IN ${CONTACT_ACTIVITY})
                                 OR EXISTS (SELECT 1 FROM opportunity_stage_history h WHERE h."opportunityId" = o.id AND h."toStage" IN ${CONTACTED_STAGES})) AS contacted,
             count(*) FILTER (WHERE EXISTS (SELECT 1 FROM quotes q WHERE q."opportunityId" = o.id AND q."deletedAt" IS NULL AND q."sentAt" IS NOT NULL)) AS quoted,
             count(*) FILTER (WHERE o.stage = 'WON') AS won
      FROM opportunities o WHERE ${cohort(f)}`,
    prisma.$queryRaw<{ reason: string; count: bigint }[]>`
      SELECT coalesce(nullif(trim(o."lostReason"), ''), 'Belirtilmedi') AS reason, count(*) AS count
      FROM opportunities o
      WHERE o."deletedAt" IS NULL AND o.stage = 'LOST' AND o."lostAt" >= ${f.from} AND o."lostAt" < ${f.to} ${owner(f)}
      GROUP BY 1 ORDER BY count DESC, reason`,
    prisma.$queryRaw<{ stage: OpportunityStage; count: bigint; avg_h: number; median_h: number }[]>`
      WITH t AS (
        SELECT h."toStage" AS stage, h."changedAt" AS entered,
               lead(h."changedAt") OVER (PARTITION BY h."opportunityId" ORDER BY h."changedAt", h.id) AS left_at
        FROM opportunity_stage_history h JOIN opportunities o ON o.id = h."opportunityId"
        WHERE o."deletedAt" IS NULL ${owner(f)}
      )
      SELECT stage, count(*) AS count,
             avg(extract(epoch FROM left_at - entered) / 3600)::float8 AS avg_h,
             (percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM left_at - entered) / 3600))::float8 AS median_h
      FROM t WHERE left_at IS NOT NULL AND entered >= ${f.from} AND entered < ${f.to} AND stage NOT IN ('WON','LOST')
      GROUP BY stage`,
    prisma.$queryRaw<{ total: bigint; contacted: bigint; within24: bigint; avg_h: number | null; median_h: number | null }[]>`
      WITH c AS (
        SELECT o.id, (SELECT min(a."occurredAt") FROM activities a WHERE a."opportunityId" = o.id AND a.type IN ${CONTACT_ACTIVITY} AND a."occurredAt" >= o."createdAt") - o."createdAt" AS d
        FROM opportunities o WHERE ${cohort(f)}
      )
      SELECT count(*) AS total, count(d) AS contacted,
             count(*) FILTER (WHERE d <= interval '24 hours') AS within24,
             (avg(extract(epoch FROM d)) / 3600)::float8 AS avg_h,
             (percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM d)) / 3600)::float8 AS median_h
      FROM c`,
    prisma.$queryRaw<{ status: QuoteStatus; currency: string; count: bigint; total: Prisma.Decimal }[]>`
      SELECT q.status, q.currency, count(*) AS count, sum(q."grandTotal") AS total
      FROM quotes q LEFT JOIN opportunities o ON o.id = q."opportunityId"
      WHERE q."deletedAt" IS NULL AND q."createdAt" >= ${f.from} AND q."createdAt" < ${f.to} ${owner(f)}
      GROUP BY q.status, q.currency ORDER BY q.currency, q.status`,
  ]);

  const fc = firstContact[0];
  const fu = funnel[0];
  return {
    bySource: bySource.map((r) => ({ source: r.source, total: n(r.total), won: n(r.won), lost: n(r.lost), open: n(r.open) })),
    funnel: { total: n(fu?.total ?? 0), contacted: n(fu?.contacted ?? 0), quoted: n(fu?.quoted ?? 0), won: n(fu?.won ?? 0) },
    lost: lost.map((r) => ({ reason: r.reason, count: n(r.count) })),
    stages: stages.map((r) => ({ stage: r.stage, count: n(r.count), avgHours: r.avg_h, medianHours: r.median_h })),
    firstContact: { total: n(fc?.total ?? 0), contacted: n(fc?.contacted ?? 0), within24: n(fc?.within24 ?? 0), avgHours: fc?.avg_h ?? null, medianHours: fc?.median_h ?? null },
    quotes: quotes.map((r) => ({ status: r.status, currency: r.currency, count: n(r.count), total: r.total.toString() })),
  };
}

export type SalesReport = Awaited<ReturnType<typeof salesReport>>;
