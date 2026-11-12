import "server-only";
import type { AppointmentStatus, AppointmentType, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { audit } from "@/lib/audit";
import { notify } from "@/lib/notifications";
import { assertCan, ForbiddenError, type Actor } from "@/lib/rbac/assert";
import { appointmentScope, contactScope, opportunityScope, projectScope } from "@/lib/rbac/scope";
import { APPOINTMENT_STATUS_LABELS, APPOINTMENT_TYPE_LABELS, STAGE_LABELS, STAGE_ORDER } from "@/lib/labels";
import { fmtDateTime } from "@/lib/format";
import { enqueueCalendarSync } from "./calendar-sync";
import { RuleError } from "@/lib/errors";

/**
 * Randevu / keşif takvimi. Kurallar:
 *  - Randevu bir müşteriye bağlıdır; fırsat/proje verilirse AYNI müşteriye ait ve kullanıcının erişiminde olmalı.
 *  - Planlanmış (PROPOSED/CONFIRMED) randevuda başlangıç ve bitiş zorunlu, bitiş > başlangıç.
 *  - Aynı kişiye çakışan planlı randevu açılmaz; kullanıcı "çakışmaya rağmen kaydet" derse kaydedilir (bilinçli karar).
 *  - Keşif/showroom randevusu onaylanınca fırsat "Showroom / keşif" aşamasına ileri taşınır (geri taşınmaz).
 */
export type AppointmentInput = {
  type: AppointmentType;
  status: AppointmentStatus;
  contactId: string;
  opportunityId: string | null;
  projectId: string | null;
  startAt: Date | null;
  endAt: Date | null;
  location: string | null;
  assignedUserId: string | null;
  requestedNote: string | null;
  notes: string | null;
  allowOverlap: boolean;
};

const SCHEDULED: AppointmentStatus[] = ["PROPOSED", "CONFIRMED"];

async function validateLinks(actor: Actor, i: AppointmentInput, t: Prisma.TransactionClient) {
  const contact = await t.contact.findFirst({ where: { id: i.contactId, ...contactScope(actor) }, select: { id: true } });
  if (!contact) throw new ForbiddenError("Müşteri bulunamadı ya da erişiminiz yok.");
  if (i.opportunityId) {
    const o = await t.opportunity.findFirst({ where: { id: i.opportunityId, ...opportunityScope(actor) }, select: { contactId: true } });
    if (!o) throw new ForbiddenError("Fırsat bulunamadı ya da erişiminiz yok.");
    if (o.contactId !== i.contactId) throw new RuleError("Seçilen fırsat bu müşteriye ait değil.");
  }
  if (i.projectId) {
    const p = await t.project.findFirst({ where: { id: i.projectId, ...projectScope(actor) }, select: { contactId: true } });
    if (!p) throw new ForbiddenError("Proje bulunamadı ya da erişiminiz yok.");
    if (p.contactId !== i.contactId) throw new RuleError("Seçilen proje bu müşteriye ait değil.");
  }
  if (i.assignedUserId) {
    const u = await t.user.findFirst({ where: { id: i.assignedUserId, status: "ACTIVE" }, select: { id: true } });
    if (!u) throw new RuleError("Atanan kullanıcı aktif değil.");
  }
  if (SCHEDULED.includes(i.status) || i.status === "COMPLETED") {
    if (!i.startAt || !i.endAt) throw new RuleError("Planlanan randevu için başlangıç ve bitiş zamanı seçin.");
  }
  if (i.startAt && i.endAt && i.endAt <= i.startAt) throw new RuleError("Bitiş, başlangıçtan sonra olmalı.");
  if (i.startAt && i.endAt && i.endAt.getTime() - i.startAt.getTime() > 3 * 86400_000) throw new RuleError("Randevu en fazla 3 gün sürebilir.");
}

/** Aynı kişiye çakışan planlı randevular (kendisi hariç). */
export async function findOverlaps(assignedUserId: string, startAt: Date, endAt: Date, excludeId?: string, t: Prisma.TransactionClient | typeof prisma = prisma) {
  return t.appointment.findMany({
    where: { assignedUserId, status: { in: SCHEDULED }, startAt: { lt: endAt }, endAt: { gt: startAt }, ...(excludeId ? { NOT: { id: excludeId } } : {}) },
    select: { id: true, startAt: true, endAt: true, type: true, contact: { select: { fullName: true } } },
    orderBy: { startAt: "asc" },
    take: 5,
  });
}

async function checkOverlap(i: AppointmentInput, excludeId: string | undefined, t: Prisma.TransactionClient) {
  if (i.allowOverlap || !i.assignedUserId || !i.startAt || !i.endAt || !SCHEDULED.includes(i.status)) return;
  const clashes = await findOverlaps(i.assignedUserId, i.startAt, i.endAt, excludeId, t);
  if (clashes.length) {
    const c = clashes[0];
    throw new RuleError(`Atanan kişinin bu saatte başka randevusu var: ${fmtDateTime(c.startAt)} ${APPOINTMENT_TYPE_LABELS[c.type]} (${c.contact.fullName}). Yine de kaydetmek için “Çakışmaya rağmen kaydet”i işaretleyin.`);
  }
}

async function advanceForSurvey(t: Prisma.TransactionClient, i: { type: AppointmentType; status: AppointmentStatus; opportunityId: string | null }, actorId: string) {
  if (!i.opportunityId || i.status !== "CONFIRMED" || (i.type !== "SITE_SURVEY" && i.type !== "SHOWROOM_VISIT")) return;
  const o = await t.opportunity.findUnique({ where: { id: i.opportunityId }, select: { stage: true, contactId: true } });
  if (!o || o.stage === "WON" || o.stage === "LOST") return;
  if (STAGE_ORDER.indexOf(o.stage) >= STAGE_ORDER.indexOf("SHOWROOM_OR_SURVEY")) return;
  const note = `${APPOINTMENT_TYPE_LABELS[i.type]} randevusu onaylandı`;
  await t.opportunity.update({ where: { id: i.opportunityId }, data: { stage: "SHOWROOM_OR_SURVEY" } });
  await t.opportunityStageHistory.create({ data: { opportunityId: i.opportunityId, fromStage: o.stage, toStage: "SHOWROOM_OR_SURVEY", changedById: actorId, note } });
  await t.activity.create({ data: { type: "STAGE_CHANGE", subject: `${STAGE_LABELS[o.stage]} → ${STAGE_LABELS.SHOWROOM_OR_SURVEY}`, body: note, actorId, contactId: o.contactId, opportunityId: i.opportunityId } });
}

const summaryOf = (i: { type: AppointmentType; startAt: Date | null }) => `${APPOINTMENT_TYPE_LABELS[i.type]}${i.startAt ? ` · ${fmtDateTime(i.startAt)}` : " · zaman bekliyor"}`;

export async function createAppointment(actor: Actor, i: AppointmentInput) {
  assertCan(actor, "calendar.manage");
  const a = await prisma.$transaction(async (t) => {
    await validateLinks(actor, i, t);
    await checkOverlap(i, undefined, t);
    const created = await t.appointment.create({
      data: {
        type: i.type,
        status: i.status,
        contactId: i.contactId,
        opportunityId: i.opportunityId,
        projectId: i.projectId,
        startAt: i.startAt,
        endAt: i.endAt,
        location: i.location,
        assignedUserId: i.assignedUserId,
        requestedNote: i.requestedNote,
        notes: i.notes,
        customerConfirmedAt: i.status === "CONFIRMED" ? new Date() : null,
        createdById: actor.id,
      },
    });
    await t.activity.create({ data: { type: "SYSTEM", subject: `Randevu: ${summaryOf(i)}`, body: i.location, actorId: actor.id, contactId: i.contactId, opportunityId: i.opportunityId, projectId: i.projectId } });
    await advanceForSurvey(t, i, actor.id);
    await audit({ actorId: actor.id, action: "appointment_created", entityType: "appointment", entityId: created.id, summary: summaryOf(i) }, t);
    await enqueueCalendarSync(t, created.id);
    return created;
  });
  if (i.assignedUserId && i.assignedUserId !== actor.id) {
    await notify({ userId: i.assignedUserId, type: "appointment", title: `Size randevu atandı: ${summaryOf(i)}`, link: `/takvim/${a.id}` });
  }
  return a;
}

async function loadForEdit(actor: Actor, id: string, t: Prisma.TransactionClient) {
  const a = await t.appointment.findFirst({ where: { id, ...appointmentScope(actor) } });
  if (!a) throw new ForbiddenError("Randevu bulunamadı ya da erişiminiz yok.");
  return a;
}

export async function updateAppointment(actor: Actor, id: string, i: AppointmentInput) {
  assertCan(actor, "calendar.manage");
  const { before, after } = await prisma.$transaction(async (t) => {
    const before = await loadForEdit(actor, id, t);
    await validateLinks(actor, i, t);
    await checkOverlap(i, id, t);
    const after = await t.appointment.update({
      where: { id },
      data: {
        type: i.type,
        status: i.status,
        contactId: i.contactId,
        opportunityId: i.opportunityId,
        projectId: i.projectId,
        startAt: i.startAt,
        endAt: i.endAt,
        location: i.location,
        assignedUserId: i.assignedUserId,
        requestedNote: i.requestedNote,
        notes: i.notes,
        customerConfirmedAt: i.status === "CONFIRMED" ? (before.customerConfirmedAt ?? new Date()) : before.customerConfirmedAt,
      },
    });
    if (before.status !== i.status) await advanceForSurvey(t, i, actor.id);
    await audit(
      {
        actorId: actor.id,
        action: "appointment_updated",
        entityType: "appointment",
        entityId: id,
        summary: summaryOf(i),
        before: { status: before.status, startAt: before.startAt?.toISOString() ?? null, assignedUserId: before.assignedUserId },
        after: { status: i.status, startAt: i.startAt?.toISOString() ?? null, assignedUserId: i.assignedUserId },
      },
      t,
    );
    await enqueueCalendarSync(t, id);
    return { before, after };
  });
  const moved = before.startAt?.getTime() !== after.startAt?.getTime() || before.status !== after.status;
  if (after.assignedUserId && after.assignedUserId !== actor.id && (moved || before.assignedUserId !== after.assignedUserId)) {
    await notify({ userId: after.assignedUserId, type: "appointment", title: `Randevu güncellendi: ${summaryOf(after)} (${APPOINTMENT_STATUS_LABELS[after.status]})`, link: `/takvim/${id}` });
  }
  return after;
}

/** Hızlı durum değişikliği (tamamlandı / gelmedi / iptal / onaylandı). */
export async function setAppointmentStatus(actor: Actor, id: string, status: AppointmentStatus) {
  assertCan(actor, "calendar.manage");
  return prisma.$transaction(async (t) => {
    const a = await loadForEdit(actor, id, t);
    if (a.status === status) return a;
    if ((SCHEDULED.includes(status) || status === "COMPLETED") && (!a.startAt || !a.endAt)) throw new RuleError("Önce randevu zamanını planlayın.");
    const updated = await t.appointment.update({ where: { id }, data: { status, customerConfirmedAt: status === "CONFIRMED" ? (a.customerConfirmedAt ?? new Date()) : a.customerConfirmedAt } });
    await advanceForSurvey(t, updated, actor.id);
    await t.activity.create({ data: { type: "SYSTEM", subject: `Randevu ${APPOINTMENT_STATUS_LABELS[status].toLocaleLowerCase("tr-TR")}: ${summaryOf(a)}`, actorId: actor.id, contactId: a.contactId, opportunityId: a.opportunityId, projectId: a.projectId } });
    await audit({ actorId: actor.id, action: "appointment_status", entityType: "appointment", entityId: id, summary: `${summaryOf(a)} → ${APPOINTMENT_STATUS_LABELS[status]}`, before: { status: a.status }, after: { status } }, t);
    await enqueueCalendarSync(t, id);
    return updated;
  });
}
