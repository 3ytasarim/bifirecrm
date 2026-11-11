/**
 * QA (yalnız geliştirme DB'si): teklif durum makinesi + PDF + toplam doğrulaması.
 * Kayıtlar @example.test / "QA " kimliğiyle açılır; ardından mutlaka: npx tsx --conditions=react-server scripts/qa-cleanup.ts --apply
 *   npx tsx --conditions=react-server scripts/qa-quotes.ts      (QA_PDF_OUT=yol → önizleme PDF'i oraya yazılır)
 */
import "dotenv/config";
import { prisma } from "@/lib/db";
import { effectivePermissions } from "@/lib/rbac/permissions";
import type { Actor } from "@/lib/rbac/assert";
import { createQuote, decideQuote, markQuoteSent, quotePdfInput, recordCustomerResponse, reviseQuote, saveQuoteDraft, submitQuote } from "@/lib/services/quotes";
import { renderQuotePdf } from "@/lib/quotes/pdf";
import { storage } from "@/lib/storage";

if (process.env.APP_ENV === "production") throw new Error("production'da çalışmaz");
let fails = 0;
const ok = (cond: unknown, msg: string) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`);
  if (!cond) fails++;
};
async function rejects(p: Promise<unknown>, re: RegExp, msg: string) {
  try {
    await p;
    ok(false, `${msg} (hata bekleniyordu)`);
  } catch (e) {
    ok(re.test(e instanceof Error ? e.message : String(e)), `${msg} → "${e instanceof Error ? e.message : e}"`);
  }
}

async function actorFor(email: string, role: "SALES" | "MANAGER"): Promise<Actor> {
  const u = await prisma.user.upsert({ where: { email }, create: { email, name: `QA ${role}`, role, status: "ACTIVE" }, update: {} });
  return { id: u.id, email: u.email, name: u.name, role: u.role, status: u.status, mfaEnabled: false, perms: effectivePermissions(u.role, []) };
}

async function main() {
  const sales = await actorFor("qa-sales@example.test", "SALES");
  const manager = await actorFor("qa-manager@example.test", "MANAGER");
  const contact = await prisma.contact.create({ data: { firstName: "QA", lastName: "Teklif Müşterisi", fullName: "QA Teklif Müşterisi", primaryEmail: "qa-teklif@example.test", ownerId: sales.id, createdById: sales.id } });
  const opp = await prisma.opportunity.create({ data: { title: "QA L tipi şömine", contactId: contact.id, ownerId: sales.id, source: "PHONE", stage: "NEW" } });

  const q = await createQuote(sales, opp.id);
  ok((await prisma.opportunity.findUnique({ where: { id: opp.id } }))?.stage === "QUOTATION_PREPARING", "teklif açılınca fırsat 'Teklif hazırlanıyor'");

  const items = [
    { description: "L tipi odunlu şömine 120 cm", quantity: "1", unit: "adet", unitPrice: "125.000", discountPct: "5", taxPct: "20" },
    { description: "Baca bağlantısı", quantity: "3,5", unit: "m", unitPrice: "1.234,56", discountPct: "0", taxPct: "20" },
    { description: "Montaj", quantity: "1", unit: "hizmet", unitPrice: "7500", discountPct: "10", taxPct: "10" },
  ];
  await saveQuoteDraft(sales, q.id, { currency: "TRY", validUntil: new Date("2026-12-31"), notes: "QA not", terms: "QA şartlar", items });
  const saved = await prisma.quote.findUniqueOrThrow({ where: { id: q.id }, include: { items: true } });
  // Elle hesap: 125000×0,95=118750 (KDV 23750) · 3,5×1234,56=4320,96 (KDV 864,19) · 7500×0,9=6750 (KDV 675)
  ok(saved.subtotal.toString() === "136820.96", `ara toplam 136820.96 (DB: ${saved.subtotal})`);
  ok(saved.discountTotal.toString() === "7000", `iskonto 7000 (DB: ${saved.discountTotal})`);
  ok(saved.taxTotal.toString() === "25289.19", `KDV 25289.19 (DB: ${saved.taxTotal})`);
  ok(saved.grandTotal.toString() === "155110.15", `genel toplam 155110.15 (DB: ${saved.grandTotal})`);
  const sumLines = saved.items.reduce((a, i) => a + Number(i.lineTotal), 0);
  ok(Math.abs(sumLines - Number(saved.subtotal) + Number(saved.discountTotal)) < 0.001, "satır toplamları = ara toplam − iskonto");

  await rejects(markQuoteSent(sales, q.id), /onaylanmadan/, "TASLAK teklif gönderildi yapılamaz");
  await rejects(decideQuote(manager, q.id, "APPROVED", null), /onay bekleyen/, "taslak onaylanamaz");
  await submitQuote(sales, q.id);
  await rejects(saveQuoteDraft(sales, q.id, { currency: "TRY", validUntil: null, notes: null, terms: null, items }), /taslak/, "onaydaki teklif düzenlenemez");
  await rejects(markQuoteSent(sales, q.id), /onaylanmadan/, "ONAY BEKLEYEN teklif gönderildi yapılamaz");
  await rejects(decideQuote(sales, q.id, "APPROVED", null), /yetkiniz/i, "satışçı onaylayamaz (izin yok)");
  await rejects(decideQuote(manager, q.id, "REJECTED", "  "), /gerekçe/, "gerekçesiz ret olmaz");
  await decideQuote(manager, q.id, "REJECTED", "İskonto fazla");
  ok((await prisma.quote.findUnique({ where: { id: q.id } }))?.status === "DRAFT", "ret sonrası teklif taslağa döndü");

  // Yönetici kendi teklifini onaylayamaz
  const own = await createQuote(manager, opp.id);
  await saveQuoteDraft(manager, own.id, { currency: "TRY", validUntil: new Date("2026-12-31"), notes: null, terms: null, items: items.slice(0, 1) });
  await submitQuote(manager, own.id);
  await rejects(decideQuote(manager, own.id, "APPROVED", null), /Kendi hazırladığınız/, "hazırlayan kendi teklifini onaylayamaz");

  await submitQuote(sales, q.id);
  await decideQuote(manager, q.id, "APPROVED", null);
  const preview = await quotePdfInput(q.id, null);
  const pdf = await renderQuotePdf(preview.input);
  if (process.env.QA_PDF_OUT) (await import("node:fs")).writeFileSync(process.env.QA_PDF_OUT, pdf);
  ok(pdf.subarray(0, 5).toString() === "%PDF-" && pdf.length > 5000, `PDF üretildi (${pdf.length} bayt)`);
  // Kurcalanmış toplam → PDF reddedilmeli
  await rejects(renderQuotePdf({ ...preview.input, stored: { ...preview.input.stored, grandTotal: "155110.16" } }), /tutarsız/, "DB toplamı kalemlerle uyuşmazsa PDF üretilmez");

  await markQuoteSent(sales, q.id);
  const sent = await prisma.quote.findUniqueOrThrow({ where: { id: q.id } });
  ok(sent.status === "SENT" && !!sent.pdfAttachmentId && !!sent.sentAt, "onaylı teklif gönderildi; PDF eklendi");
  const att = await prisma.attachment.findUniqueOrThrow({ where: { id: sent.pdfAttachmentId! } });
  const stored = await (await storage()).get(att.storageKey);
  ok(stored.length === att.sizeBytes && att.opportunityId === opp.id && att.kind === "QUOTE", "kalıcı PDF depoda, fırsata bağlı");
  ok((await prisma.opportunity.findUnique({ where: { id: opp.id } }))?.stage === "QUOTATION_SENT", "fırsat 'Teklif gönderildi'");
  await rejects(markQuoteSent(sales, q.id), /onaylanmadan/, "ikinci kez gönderilemez");

  const v2 = await reviseQuote(sales, q.id);
  ok(v2.version === 2 && v2.rootId === q.id && v2.status === "DRAFT", "revize → sürüm 2 taslak");
  ok((await prisma.quote.findUnique({ where: { id: q.id } }))?.status === "SENT", "eski sürüm değişmedi");
  await rejects(reviseQuote(sales, q.id), /açık bir taslak/, "aynı anda iki taslak sürüm olmaz");

  await recordCustomerResponse(sales, q.id, "ACCEPTED", null);
  ok((await prisma.opportunity.findUnique({ where: { id: opp.id } }))?.stage === "NEGOTIATION", "kabul → fırsat 'Pazarlık'");

  console.log(fails ? `\n${fails} HATA` : "\nTümü geçti");
  process.exitCode = fails ? 1 : 0;
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
