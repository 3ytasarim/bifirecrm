import { NextResponse, type NextRequest } from "next/server";
import type { LeadSource, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { audit } from "@/lib/audit";
import { toCsv } from "@/lib/csv";
import { rateLimit } from "@/lib/rate-limit";
import { getActorOrNull } from "@/lib/rbac/guard";
import { contactScope, opportunityScope, projectScope, taskScope } from "@/lib/rbac/scope";
import { contactSearchWhere } from "@/lib/search";
import { FIREPLACE_LABELS, PROJECT_STAGE_LABELS, SOURCE_LABELS, STAGE_LABELS, TASK_STATUS_LABELS, PRIORITY_LABELS } from "@/lib/labels";
import { code, fmtDateTime } from "@/lib/format";

const MAX_ROWS = 50_000;

/** Yetkiye tabi CSV dışa aktarımı. Her dışa aktarım denetim kaydına yazılır. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ entity: string }> }) {
  const actor = await getActorOrNull();
  if (!actor) return new NextResponse("Oturum gerekli", { status: 401 });
  if (!actor.perms.has("data.export")) return new NextResponse("Yetkisiz", { status: 403 });
  const rl = await rateLimit(`export:${actor.id}`, 20, 3600);
  if (!rl.ok) return new NextResponse("Saatlik dışa aktarım sınırı aşıldı.", { status: 429 });
  const { entity } = await params;
  const sp = req.nextUrl.searchParams;
  let csv: string;
  let count = 0;

  if (entity === "contacts") {
    const source = sp.get("kaynak");
    const where: Prisma.ContactWhereInput = { AND: [contactScope(actor), contactSearchWhere(sp.get("q") ?? undefined), source && source in SOURCE_LABELS ? { source: source as LeadSource } : {}] };
    const rows = await prisma.contact.findMany({ where, take: MAX_ROWS, orderBy: { number: "asc" }, include: { owner: { select: { name: true } }, organization: { select: { name: true } } } });
    count = rows.length;
    csv = toCsv(
      ["No", "Ad Soyad", "Şirket", "Telefon", "E-posta", "İl", "İlçe", "Adres", "Kaynak", "Etiketler", "Sorumlu", "KVKK aydınlatma", "Pazarlama izni", "Kayıt tarihi"],
      rows.map((c) => [code.contact(c.number), c.fullName, c.organization?.name, c.primaryPhone, c.primaryEmail, c.city, c.district, c.address, SOURCE_LABELS[c.source], c.tags.join(", "), c.owner?.name, c.kvkkNoticeAt ? fmtDateTime(c.kvkkNoticeAt) : "", c.marketingConsent ? "Evet" : "Hayır", fmtDateTime(c.createdAt)]),
    );
  } else if (entity === "opportunities") {
    const rows = await prisma.opportunity.findMany({ where: opportunityScope(actor), take: MAX_ROWS, orderBy: { number: "asc" }, include: { contact: { select: { fullName: true } }, owner: { select: { name: true } } } });
    count = rows.length;
    csv = toCsv(
      ["No", "Başlık", "Müşteri", "Aşama", "Kaynak", "Ürün türü", "Model", "Tahmini tutar", "Para birimi", "Beklenen kapanış", "Son temas", "Sonraki aksiyon", "Kayıp nedeni", "Sorumlu", "Oluşturma"],
      rows.map((o) => [code.opportunity(o.number), o.title, o.contact.fullName, STAGE_LABELS[o.stage], SOURCE_LABELS[o.source], o.fireplaceType ? FIREPLACE_LABELS[o.fireplaceType] : "", o.productModel, o.estimatedAmount?.toString() ?? "", o.currency, o.expectedCloseDate?.toISOString().slice(0, 10) ?? "", fmtDateTime(o.lastContactAt), fmtDateTime(o.nextActionAt), o.lostReason, o.owner?.name, fmtDateTime(o.createdAt)]),
    );
  } else if (entity === "projects") {
    const rows = await prisma.project.findMany({ where: projectScope(actor), take: MAX_ROWS, orderBy: { number: "asc" }, include: { contact: { select: { fullName: true } }, technicalUser: { select: { name: true } }, installationUser: { select: { name: true } } } });
    count = rows.length;
    csv = toCsv(
      ["No", "Proje", "Müşteri", "Aşama", "Şömine türü", "Model", "İlçe", "Duvar (cm)", "Tavan (cm)", "Planlanan sevkiyat", "Planlanan montaj", "Tarih teknik onayı", "Teknik", "Montaj"],
      rows.map((p) => [code.project(p.number), p.name, p.contact.fullName, PROJECT_STAGE_LABELS[p.stage], p.fireplaceType ? FIREPLACE_LABELS[p.fireplaceType] : "", p.productModel, p.siteDistrict, p.wallWidthCm?.toString() ?? "", p.ceilingHeightCm?.toString() ?? "", p.plannedShipDate?.toISOString().slice(0, 10) ?? "", p.plannedInstallDate?.toISOString().slice(0, 10) ?? "", p.datesApprovedAt ? fmtDateTime(p.datesApprovedAt) : "", p.technicalUser?.name, p.installationUser?.name]),
    );
  } else if (entity === "tasks") {
    const rows = await prisma.task.findMany({ where: taskScope(actor), take: MAX_ROWS, orderBy: { createdAt: "asc" }, include: { assignee: { select: { name: true } }, contact: { select: { fullName: true } } } });
    count = rows.length;
    csv = toCsv(
      ["Görev", "Durum", "Öncelik", "Son tarih", "Sorumlu", "Müşteri", "Tamamlanma", "Oluşturma"],
      rows.map((t) => [t.title, TASK_STATUS_LABELS[t.status], PRIORITY_LABELS[t.priority], fmtDateTime(t.dueAt), t.assignee?.name, t.contact?.fullName, fmtDateTime(t.completedAt), fmtDateTime(t.createdAt)]),
    );
  } else if (entity === "audit") {
    if (!actor.perms.has("audit.view")) return new NextResponse("Yetkisiz", { status: 403 });
    const rows = await prisma.auditLog.findMany({ take: MAX_ROWS, orderBy: { createdAt: "desc" }, include: { actor: { select: { name: true, email: true } } } });
    count = rows.length;
    csv = toCsv(
      ["Zaman", "Kullanıcı", "E-posta", "İşlem", "Kayıt türü", "Kayıt", "Özet", "Önce", "Sonra"],
      rows.map((r) => [fmtDateTime(r.createdAt), r.actor?.name, r.actor?.email, r.action, r.entityType, r.entityId, r.summary, r.before ? JSON.stringify(r.before) : "", r.after ? JSON.stringify(r.after) : ""]),
    );
  } else {
    return new NextResponse("Bulunamadı", { status: 404 });
  }

  await audit({ actorId: actor.id, action: "export", entityType: entity, summary: `${count} satır CSV` });
  const stamp = new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 16).replace(/[:T]/g, "-");
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="bifire-${entity}-${stamp}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
