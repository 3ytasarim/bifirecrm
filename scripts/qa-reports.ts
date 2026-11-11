/**
 * QA (yalnız geliştirme DB'si): rapor rakamları (1) bilinen QA verisiyle elle hesaplanan değerlere, (2) bağımsız ORM sayımlarına eşit mi?
 * Kayıtlar @example.test / "QA " kimliğiyle açılır; ardından mutlaka: npx tsx --conditions=react-server scripts/qa-cleanup.ts --apply
 */
import "dotenv/config";
import { prisma } from "@/lib/db";
import { effectivePermissions } from "@/lib/rbac/permissions";
import type { Actor } from "@/lib/rbac/assert";
import { salesReport } from "@/lib/services/reports";

if (process.env.APP_ENV === "production") throw new Error("production'da çalışmaz");
let fails = 0;
const eq = (a: unknown, b: unknown, msg: string) => {
  const ok = JSON.stringify(a) === JSON.stringify(b);
  console.log(`${ok ? "PASS" : "FAIL"}  ${msg}${ok ? "" : `\n      beklenen ${JSON.stringify(b)}\n      gelen    ${JSON.stringify(a)}`}`);
  if (!ok) fails++;
};
const H = 3600_000;
const now = Date.now();
const at = (h: number) => new Date(now + h * H);

async function main() {
  const u = await prisma.user.upsert({ where: { email: "qa-report@example.test" }, create: { email: "qa-report@example.test", name: "QA Rapor", role: "MANAGER", status: "ACTIVE" }, update: {} });
  const actor: Actor = { id: u.id, email: u.email, name: u.name, role: u.role, status: u.status, mfaEnabled: false, perms: effectivePermissions(u.role, []) };
  const c = await prisma.contact.create({ data: { firstName: "QA", lastName: "Rapor", fullName: "QA Rapor Müşterisi", primaryEmail: "qa-rapor@example.test", ownerId: u.id } });
  const opp = (title: string, source: "PHONE" | "WEBSITE_CONTACT", createdH: number, stage: "WON" | "LOST" | "NEW", extra = {}) =>
    prisma.opportunity.create({ data: { title, contactId: c.id, ownerId: u.id, source, stage, createdAt: at(createdH), ...extra } });
  const hist = (opportunityId: string, rows: [string, number][]) =>
    prisma.opportunityStageHistory.createMany({ data: rows.map(([toStage, h]) => ({ opportunityId, toStage: toStage as never, changedAt: at(h) })) });

  const o1 = await opp("QA rapor 1", "PHONE", -120, "WON", { wonAt: at(-24) });
  await hist(o1.id, [["NEW", -120], ["CONTACTED", -96], ["QUOTATION_SENT", -48], ["WON", -24]]);
  await prisma.activity.create({ data: { type: "CALL", occurredAt: at(-118), contactId: c.id, opportunityId: o1.id } });
  await prisma.quote.create({ data: { contactId: c.id, opportunityId: o1.id, status: "ACCEPTED", currency: "TRY", grandTotal: "1000", subtotal: "1000", sentAt: at(-48), createdAt: at(-50) } });

  const o2 = await opp("QA rapor 2", "WEBSITE_CONTACT", -72, "LOST", { lostAt: at(-24), lostReason: "Fiyat yüksek bulundu" });
  await hist(o2.id, [["NEW", -72], ["LOST", -24]]);
  await prisma.activity.create({ data: { type: "WHATSAPP", occurredAt: at(-42), contactId: c.id, opportunityId: o2.id } });
  await prisma.quote.create({ data: { contactId: c.id, opportunityId: o2.id, status: "DRAFT", currency: "EUR", grandTotal: "500", subtotal: "500", createdAt: at(-48) } });

  const o3 = await opp("QA rapor 3", "WEBSITE_CONTACT", -48, "NEW");
  await hist(o3.id, [["NEW", -48]]);
  // Aralık dışı (11 gün önce) — sayılmamalı
  const o4 = await opp("QA rapor eski", "PHONE", -264, "LOST", { lostAt: at(-260), lostReason: "Bütçe yok" });
  await hist(o4.id, [["NEW", -264], ["LOST", -260]]);

  const f = { from: at(-240), to: at(1), ownerId: u.id };
  const r = await salesReport(actor, f);
  eq(r.bySource, [ { source: "WEBSITE_CONTACT", total: 2, won: 0, lost: 1, open: 1 }, { source: "PHONE", total: 1, won: 1, lost: 0, open: 0 } ], "kaynak / dönüşüm");
  eq(r.funnel, { total: 3, contacted: 2, quoted: 1, won: 1 }, "huni");
  eq(r.lost, [{ reason: "Fiyat yüksek bulundu", count: 1 }], "kayıp nedenleri (aralık dışı 'Bütçe yok' hariç)");
  const st = Object.fromEntries(r.stages.map((s) => [s.stage, [s.count, Math.round(s.avgHours * 100) / 100, Math.round(s.medianHours * 100) / 100]]));
  eq(st, { NEW: [2, 36, 36], CONTACTED: [1, 48, 48], QUOTATION_SENT: [1, 24, 24] }, "aşama süreleri (adet, ort. sa, medyan sa)");
  eq({ ...r.firstContact, avgHours: Math.round((r.firstContact.avgHours ?? 0) * 100) / 100, medianHours: Math.round((r.firstContact.medianHours ?? 0) * 100) / 100 }, { total: 3, contacted: 2, within24: 1, avgHours: 16, medianHours: 16 }, "ilk temas (2 sa ve 30 sa)");
  eq(r.quotes.map((q) => [q.status, q.currency, q.count, Number(q.total)]), [["DRAFT", "EUR", 1, 500], ["ACCEPTED", "TRY", 1, 1000]], "teklifler");

  // (2) Filtresiz rapor = bağımsız ORM sayımları (tüm DB, son 365 gün)
  const g = { from: at(-24 * 365), to: at(1), ownerId: null };
  const all = await salesReport(actor, g);
  const where = { deletedAt: null, createdAt: { gte: g.from, lt: g.to } };
  const [total, won, lost, bySrc, lostBy, quotes] = await Promise.all([
    prisma.opportunity.count({ where }),
    prisma.opportunity.count({ where: { ...where, stage: "WON" } }),
    prisma.opportunity.count({ where: { ...where, stage: "LOST" } }),
    prisma.opportunity.groupBy({ by: ["source"], where, _count: { _all: true } }),
    prisma.opportunity.groupBy({ by: ["lostReason"], where: { deletedAt: null, stage: "LOST", lostAt: { gte: g.from, lt: g.to } }, _count: { _all: true } }),
    prisma.quote.groupBy({ by: ["status", "currency"], where: { deletedAt: null, createdAt: { gte: g.from, lt: g.to } }, _count: { _all: true }, _sum: { grandTotal: true } }),
  ]);
  eq([all.funnel.total, all.funnel.won, all.bySource.reduce((a, b) => a + b.lost, 0)], [total, won, lost], `ORM: toplam/kazanılan/kaybedilen (${total}/${won}/${lost})`);
  const srcMap = (xs: { source: string; n: number }[]) => Object.fromEntries(xs.map((x) => [x.source, x.n]).sort());
  eq(srcMap(all.bySource.map((s) => ({ source: s.source, n: s.total }))), srcMap(bySrc.map((s) => ({ source: s.source, n: s._count._all }))), "ORM: kaynak dağılımı");
  eq(all.lost.reduce((a, b) => a + b.count, 0), lostBy.reduce((a, b) => a + b._count._all, 0), "ORM: kayıp nedenleri toplamı");
  const qk = (xs: [string, string, number, string][]) => xs.sort().map((x) => x.join("|"));
  eq(qk(all.quotes.map((q) => [q.status, q.currency, q.count, Number(q.total).toFixed(2)])), qk(quotes.map((q) => [q.status, q.currency, q._count._all, Number(q._sum.grandTotal ?? 0).toFixed(2)])), "ORM: teklif adet/toplamları");

  console.log(fails ? `\n${fails} HATA` : "\nTümü geçti");
  process.exitCode = fails ? 1 : 0;
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
