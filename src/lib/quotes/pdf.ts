import "server-only";
import path from "node:path";
import PDFDocument from "pdfkit";
import { calcQuote, formatAmount, formatPct, fromScaled, toScaled } from "./calc";

/**
 * Teklif PDF'i (A4). Tutarlar DB'den değil kalemlerden calcQuote ile yeniden hesaplanır ve DB toplamıyla
 * karşılaştırılır: tutarsızlık varsa PDF üretilmez (yanlış tutarlı teklif müşteriye gitmesin).
 * Türkçe karakterler için DejaVu Sans gömülür (pdfkit'in standart fontlarında ğ/ş/ı yok).
 */
const FONT_DIR = path.join(/*turbopackIgnore: true*/ process.cwd(), "node_modules", "dejavu-fonts-ttf", "ttf");

export type QuotePdfInput = {
  code: string;
  version: number;
  status: string;
  /** Onaylanmamış teklifte büyük "TASLAK" filigranı basılır. */
  watermark: string | null;
  issuedAt: Date;
  validUntil: Date | null;
  currency: string;
  company: string[];
  customer: { name: string; lines: string[] };
  opportunityTitle: string | null;
  items: { description: string; quantity: string; unit: string; unitPrice: string; discountPct: string; taxPct: string }[];
  stored: { subtotal: string; discountTotal: string; taxTotal: string; grandTotal: string };
  notes: string | null;
  terms: string | null;
  preparedBy: string | null;
};

const fmtQty = (q: string) => Number(q).toLocaleString("tr-TR", { maximumFractionDigits: 3 });
const fmtDay = (d: Date) => new Intl.DateTimeFormat("tr-TR", { timeZone: "Europe/Istanbul", day: "2-digit", month: "2-digit", year: "numeric" }).format(d);

export async function renderQuotePdf(input: QuotePdfInput): Promise<Buffer> {
  // Kalemler hangi biçimde gelirse gelsin ("1.234,56" / "1234.56") hesapla aynı ayrıştırıcıdan geçer.
  const n = (v: string, d: number) => fromScaled(toScaled(v, d), d);
  const q = { ...input, items: input.items.map((i) => ({ ...i, quantity: n(i.quantity, 3), unitPrice: n(i.unitPrice, 2), discountPct: n(i.discountPct, 2), taxPct: n(i.taxPct, 2) })) };
  const totals = calcQuote(q.items);
  for (const k of ["subtotal", "discountTotal", "taxTotal", "grandTotal"] as const) {
    if (Number(totals[k]).toFixed(2) !== Number(q.stored[k]).toFixed(2)) throw new Error(`Teklif tutarları tutarsız (${k}); PDF üretilmedi.`);
  }

  const doc = new PDFDocument({ size: "A4", margins: { top: 48, bottom: 56, left: 48, right: 48 }, bufferPages: true, info: { Title: `Teklif ${q.code}`, Author: q.company[0] ?? "Bifire" } });
  doc.registerFont("r", path.join(FONT_DIR, "DejaVuSans.ttf"));
  doc.registerFont("b", path.join(FONT_DIR, "DejaVuSans-Bold.ttf"));
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  const L = doc.page.margins.left;
  const W = doc.page.width - L - doc.page.margins.right;
  const bottom = () => doc.page.height - doc.page.margins.bottom;
  const ink = "#1c1917";
  const muted = "#6b6560";
  const line = "#d6d3d1";

  // ── Üst bilgi
  doc.font("b").fontSize(15).fillColor(ink).text(q.company[0] ?? "Bifire Şömine", L, 48, { width: W * 0.6 });
  doc.font("r").fontSize(8.5).fillColor(muted);
  for (const l of q.company.slice(1)) doc.text(l, { width: W * 0.6 });
  const leftBottom = doc.y;
  doc.font("b").fontSize(18).fillColor(ink).text("TEKLİF", L + W * 0.6, 48, { width: W * 0.4, align: "right" });
  doc.font("r").fontSize(9).fillColor(muted);
  const meta = [`No: ${q.code}${q.version > 1 ? ` · Sürüm ${q.version}` : ""}`, `Tarih: ${fmtDay(q.issuedAt)}`, q.validUntil ? `Geçerlilik: ${fmtDay(q.validUntil)}` : null].filter(Boolean) as string[];
  for (const m of meta) doc.text(m, L + W * 0.6, undefined, { width: W * 0.4, align: "right" });
  let y = Math.max(leftBottom, doc.y) + 14;
  doc.moveTo(L, y).lineTo(L + W, y).strokeColor(line).lineWidth(0.8).stroke();
  y += 12;

  // ── Müşteri
  doc.font("r").fontSize(8).fillColor(muted).text("SAYIN", L, y);
  doc.font("b").fontSize(11).fillColor(ink).text(q.customer.name, L, doc.y + 2, { width: W * 0.6 });
  doc.font("r").fontSize(9).fillColor(muted);
  for (const l of q.customer.lines) doc.text(l, { width: W * 0.6 });
  if (q.opportunityTitle) {
    doc.font("r").fontSize(8).fillColor(muted).text("KONU", L + W * 0.6, y, { width: W * 0.4, align: "right" });
    doc.font("r").fontSize(9.5).fillColor(ink).text(q.opportunityTitle, L + W * 0.6, undefined, { width: W * 0.4, align: "right" });
  }
  y = doc.y + 18;

  // ── Kalem tablosu
  const cols = [
    { key: "no", label: "#", w: 0.05, align: "left" as const },
    { key: "desc", label: "Açıklama", w: 0.37, align: "left" as const },
    { key: "qty", label: "Miktar", w: 0.1, align: "right" as const },
    { key: "price", label: "Birim fiyat", w: 0.15, align: "right" as const },
    { key: "disc", label: "İsk.", w: 0.07, align: "right" as const },
    { key: "tax", label: "KDV", w: 0.07, align: "right" as const },
    { key: "total", label: "Tutar", w: 0.19, align: "right" as const },
  ];
  const colX: number[] = [];
  cols.reduce((x, c) => (colX.push(x), x + c.w * W), L);
  const header = () => {
    doc.rect(L, y, W, 20).fill("#f5f5f4");
    doc.font("b").fontSize(8).fillColor(muted);
    cols.forEach((c, i) => doc.text(c.label, colX[i] + 4, y + 6, { width: c.w * W - 8, align: c.align }));
    y += 24;
  };
  header();
  q.items.forEach((it, idx) => {
    const r = totals.items[idx];
    const cells: Record<string, string> = {
      no: String(idx + 1),
      desc: it.description,
      qty: `${fmtQty(it.quantity)} ${it.unit}`,
      price: formatAmount(it.unitPrice, q.currency),
      disc: Number(it.discountPct) ? formatPct(it.discountPct) : "—",
      tax: formatPct(it.taxPct),
      total: formatAmount(r.net, q.currency),
    };
    doc.font("r").fontSize(9);
    const h = Math.max(...cols.map((c) => doc.heightOfString(cells[c.key], { width: c.w * W - 8 }))) + 10;
    if (y + h > bottom() - 20) {
      doc.addPage();
      y = doc.page.margins.top;
      header();
    }
    doc.fontSize(9).fillColor(ink);
    cols.forEach((c, i) => doc.font(c.key === "total" ? "b" : "r").text(cells[c.key], colX[i] + 4, y + 5, { width: c.w * W - 8, align: c.align }));
    y += h;
    doc.moveTo(L, y).lineTo(L + W, y).strokeColor(line).lineWidth(0.5).stroke();
  });

  // ── Toplamlar
  const rows: [string, string, boolean?][] = [["Ara toplam", formatAmount(totals.subtotal, q.currency)]];
  if (Number(totals.discountTotal)) rows.push(["İskonto", "−" + formatAmount(totals.discountTotal, q.currency)]);
  for (const t of totals.taxBreakdown) rows.push([`KDV ${formatPct(t.rate)} (matrah ${formatAmount(t.base, q.currency)})`, formatAmount(t.tax, q.currency)]);
  rows.push(["GENEL TOPLAM", formatAmount(totals.grandTotal, q.currency), true]);
  if (y + rows.length * 18 + 20 > bottom()) {
    doc.addPage();
    y = doc.page.margins.top;
  }
  y += 10;
  for (const [label, value, strong] of rows) {
    if (strong) {
      doc.rect(L + W * 0.45, y - 3, W * 0.55, 22).fill("#f5f5f4");
      y += 2;
    }
    doc.font(strong ? "b" : "r").fontSize(strong ? 11 : 9).fillColor(strong ? ink : muted).text(label, L + W * 0.45, y, { width: W * 0.33, align: "right" });
    doc.font("b").fillColor(ink).text(value, L + W * 0.78, y, { width: W * 0.22 - 4, align: "right" });
    y += strong ? 24 : 17;
  }

  // ── Notlar / şartlar
  const block = (title: string, body: string | null) => {
    if (!body?.trim()) return;
    doc.font("r").fontSize(9);
    const h = doc.heightOfString(body, { width: W }) + 24;
    if (y + h > bottom()) {
      doc.addPage();
      y = doc.page.margins.top;
    }
    y += 10;
    doc.font("b").fontSize(9).fillColor(ink).text(title, L, y);
    doc.font("r").fontSize(9).fillColor(muted).text(body, L, doc.y + 3, { width: W });
    y = doc.y + 4;
  };
  block("Notlar", q.notes);
  block("Teklif şartları", q.terms);
  if (q.preparedBy) block("Hazırlayan", q.preparedBy);

  // ── Filigran + sayfa altı (tüm sayfalar)
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    if (q.watermark) {
      doc.save();
      doc.rotate(-35, { origin: [doc.page.width / 2, doc.page.height / 2] });
      doc.font("b").fontSize(64).fillColor("#dc2626").opacity(0.12).text(q.watermark, 0, doc.page.height / 2 - 40, { width: doc.page.width, align: "center", lineBreak: false });
      doc.restore();
      doc.opacity(1);
    }
    // Alt boşluk içine yazarken pdfkit otomatik yeni sayfa açmasın diye kenar boşluğu geçici sıfırlanır.
    const mb = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc.font("r").fontSize(7.5).fillColor(muted).text(`${q.code} · Sayfa ${i - range.start + 1}/${range.count}`, L, doc.page.height - 36, { width: W, align: "right", lineBreak: false });
    doc.page.margins.bottom = mb;
  }

  doc.end();
  return done;
}
