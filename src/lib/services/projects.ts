import "server-only";
import type { ChimneyStatus, FireplaceType, GlassOrientation, ProjectStage } from "@prisma/client";
import { prisma } from "@/lib/db";
import { audit, diff, redact } from "@/lib/audit";
import { notify } from "@/lib/notifications";
import { PROJECT_STAGE_LABELS } from "@/lib/labels";
import { assertCan, ForbiddenError, type Actor } from "@/lib/rbac/assert";
import { opportunityScope, projectScope } from "@/lib/rbac/scope";

export type ProjectInput = {
  name: string;
  fireplaceType?: FireplaceType | null;
  productCategory?: string | null;
  productModel?: string | null;
  siteAddress?: string | null;
  siteCity?: string | null;
  siteDistrict?: string | null;
  wallWidthCm?: string | null;
  ceilingHeightCm?: string | null;
  chimneyStatus: ChimneyStatus;
  glassOrientation?: GlassOrientation | null;
  cladding?: string | null;
  technicalNotes?: string | null;
  surveyDate?: Date | null;
  ownerId?: string | null;
  technicalUserId?: string | null;
  installationUserId?: string | null;
  plannedShipDate?: Date | null;
  plannedInstallDate?: Date | null;
  holdReason?: string | null;
};

const clean = (v?: string | null) => v?.trim() || null;

function toData(input: ProjectInput) {
  return {
    name: input.name.trim(),
    fireplaceType: input.fireplaceType ?? null,
    productCategory: clean(input.productCategory),
    productModel: clean(input.productModel),
    siteAddress: clean(input.siteAddress),
    siteCity: clean(input.siteCity),
    siteDistrict: clean(input.siteDistrict),
    wallWidthCm: clean(input.wallWidthCm),
    ceilingHeightCm: clean(input.ceilingHeightCm),
    chimneyStatus: input.chimneyStatus,
    glassOrientation: input.glassOrientation ?? null,
    cladding: clean(input.cladding),
    technicalNotes: clean(input.technicalNotes),
    surveyDate: input.surveyDate ?? null,
    technicalUserId: input.technicalUserId ?? null,
    installationUserId: input.installationUserId ?? null,
    plannedShipDate: input.plannedShipDate ?? null,
    plannedInstallDate: input.plannedInstallDate ?? null,
    holdReason: clean(input.holdReason),
  };
}

/** Kazanılan fırsattan proje açar. Fırsat bilgileri (ürün, konum) başlangıç değeri olarak kopyalanır. */
export async function createProjectFromOpportunity(actor: Actor, opportunityId: string, input: ProjectInput) {
  assertCan(actor, "projects.create");
  return prisma.$transaction(async (t) => {
    const opp = await t.opportunity.findFirst({ where: { id: opportunityId, ...opportunityScope(actor) } });
    if (!opp) throw new ForbiddenError("Fırsat bulunamadı ya da erişiminiz yok.");
    if (opp.stage !== "WON") throw new Error("Proje yalnız kazanılmış fırsattan açılabilir.");
    const p = await t.project.create({
      data: {
        ...toData(input),
        fireplaceType: input.fireplaceType ?? opp.fireplaceType,
        productCategory: clean(input.productCategory) ?? opp.productCategory,
        productModel: clean(input.productModel) ?? opp.productModel,
        siteCity: clean(input.siteCity) ?? opp.city,
        siteDistrict: clean(input.siteDistrict) ?? opp.district,
        contactId: opp.contactId,
        opportunityId: opp.id,
        ownerId: input.ownerId ?? opp.ownerId ?? actor.id,
        createdById: actor.id,
      },
    });
    await t.projectStageHistory.create({ data: { projectId: p.id, toStage: p.stage, changedById: actor.id } });
    await t.activity.create({ data: { type: "SYSTEM", subject: `Proje açıldı: ${p.name}`, actorId: actor.id, contactId: p.contactId, opportunityId: opp.id, projectId: p.id } });
    await audit({ actorId: actor.id, action: "project_created", entityType: "project", entityId: p.id, summary: p.name, after: redact({ ...p }) }, t);
    for (const uid of new Set([p.technicalUserId, p.installationUserId].filter(Boolean) as string[])) {
      if (uid !== actor.id) await notify({ userId: uid, type: "assignment", title: `Projeye atandınız: ${p.name}`, link: `/projeler/${p.id}` }, t);
    }
    return p;
  });
}

export async function updateProject(actor: Actor, id: string, input: ProjectInput) {
  assertCan(actor, "projects.edit");
  return prisma.$transaction(async (t) => {
    const before = await t.project.findFirst({ where: { id, ...projectScope(actor) } });
    if (!before) throw new ForbiddenError("Proje bulunamadı ya da erişiminiz yok.");
    const data = { ...toData(input), ownerId: input.ownerId ?? before.ownerId };
    // Tarih değişirse önceki teknik onay geçersiz olur (yeniden onay gerekir).
    const datesChanged =
      (before.plannedShipDate?.getTime() ?? null) !== (data.plannedShipDate?.getTime() ?? null) ||
      (before.plannedInstallDate?.getTime() ?? null) !== (data.plannedInstallDate?.getTime() ?? null);
    const after = await t.project.update({
      where: { id },
      data: { ...data, ...(datesChanged ? { datesApprovedAt: null, datesApprovedById: null } : {}) },
    });
    const d = diff(before as unknown as Record<string, unknown>, data);
    if (d.changed.length) {
      await audit({ actorId: actor.id, action: "project_updated", entityType: "project", entityId: id, summary: `Değişen: ${d.changed.join(", ")}`, before: d.before, after: d.after }, t);
    }
    for (const key of ["technicalUserId", "installationUserId", "ownerId"] as const) {
      const uid = data[key];
      if (uid && uid !== before[key] && uid !== actor.id) {
        await notify({ userId: uid, type: "assignment", title: `Projeye atandınız: ${after.name}`, link: `/projeler/${id}` }, t);
        await t.activity.create({ data: { type: "ASSIGNMENT", subject: "Proje görevlisi değişti", actorId: actor.id, contactId: after.contactId, projectId: id } });
      }
    }
    return after;
  });
}

export async function moveProjectStage(actor: Actor, id: string, toStage: ProjectStage, note?: string | null) {
  assertCan(actor, "projects.edit");
  return prisma.$transaction(async (t) => {
    const p = await t.project.findFirst({ where: { id, ...projectScope(actor) } });
    if (!p) throw new ForbiddenError("Proje bulunamadı ya da erişiminiz yok.");
    if (p.stage === toStage) return;
    if (toStage === "ON_HOLD" && !note?.trim()) throw new Error("Beklemeye alma nedeni zorunlu.");
    const now = new Date();
    await t.project.update({
      where: { id },
      data: {
        stage: toStage,
        ...(toStage === "INSTALLED" ? { installedAt: now } : {}),
        ...(toStage === "COMPLETED" ? { completedAt: now } : {}),
        ...(toStage === "ON_HOLD" ? { holdReason: note?.trim() } : {}),
      },
    });
    await t.projectStageHistory.create({ data: { projectId: id, fromStage: p.stage, toStage, changedById: actor.id, note: note ?? null } });
    await t.activity.create({
      data: { type: "STAGE_CHANGE", subject: `${PROJECT_STAGE_LABELS[p.stage]} → ${PROJECT_STAGE_LABELS[toStage]}`, body: note ?? null, actorId: actor.id, contactId: p.contactId, projectId: id, metadata: { from: p.stage, to: toStage } },
    });
    await audit({ actorId: actor.id, action: "project_stage", entityType: "project", entityId: id, before: { stage: p.stage }, after: { stage: toStage } }, t);
    for (const uid of new Set([p.ownerId, p.technicalUserId, p.installationUserId].filter(Boolean) as string[])) {
      if (uid !== actor.id) await notify({ userId: uid, type: "stage", title: `${p.name}: ${PROJECT_STAGE_LABELS[toStage]}`, link: `/projeler/${id}` }, t);
    }
  });
}

/**
 * Teknik ekip, iç planlama tarihlerini onaylar. Onay olmadan tarih "kesin" sayılmaz; sistem müşteriye
 * hiçbir koşulda otomatik tarih bildirimi göndermez (MVP'de müşteriye otomatik mesaj yok).
 */
export async function approveProjectDates(actor: Actor, id: string) {
  assertCan(actor, "projects.approve_dates");
  return prisma.$transaction(async (t) => {
    const p = await t.project.findFirst({ where: { id, ...projectScope(actor) } });
    if (!p) throw new ForbiddenError("Proje bulunamadı ya da erişiminiz yok.");
    if (!p.plannedShipDate && !p.plannedInstallDate) throw new Error("Onaylanacak sevkiyat/montaj tarihi yok.");
    await t.project.update({ where: { id }, data: { datesApprovedAt: new Date(), datesApprovedById: actor.id } });
    await t.activity.create({ data: { type: "SYSTEM", subject: "Sevkiyat/montaj tarihleri teknik ekipçe onaylandı", actorId: actor.id, contactId: p.contactId, projectId: id } });
    await audit({ actorId: actor.id, action: "project_dates_approved", entityType: "project", entityId: id, after: { plannedShipDate: p.plannedShipDate?.toISOString() ?? null, plannedInstallDate: p.plannedInstallDate?.toISOString() ?? null } }, t);
  });
}
