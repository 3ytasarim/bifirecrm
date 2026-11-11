import "server-only";
import type { FireplaceType, LeadSource, OpportunityStage, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { audit, diff, redact } from "@/lib/audit";
import { notify } from "@/lib/notifications";
import { STAGE_LABELS } from "@/lib/labels";
import { assertCan, ForbiddenError, type Actor } from "@/lib/rbac/assert";
import { contactScope, opportunityScope } from "@/lib/rbac/scope";
import { code } from "@/lib/format";

type Tx = Prisma.TransactionClient;

export type OpportunityInput = {
  title: string;
  contactId: string;
  source: LeadSource;
  ownerId?: string | null;
  fireplaceType?: FireplaceType | null;
  productCategory?: string | null;
  productModel?: string | null;
  city?: string | null;
  district?: string | null;
  message?: string | null;
  estimatedAmount?: string | null;
  currency: string;
  expectedCloseDate?: Date | null;
  nextActionAt?: Date | null;
  nextActionNote?: string | null;
};

export async function topPosition(t: Tx, stage: OpportunityStage) {
  const first = await t.opportunity.findFirst({ where: { stage, deletedAt: null }, orderBy: { position: "asc" }, select: { position: true } });
  return (first?.position ?? 1000) - 1000;
}

export async function createOpportunity(actor: Actor, input: OpportunityInput, tx?: Tx, opts?: { skipContactScope?: boolean }) {
  assertCan(actor, "opportunities.create");
  const run = async (t: Tx) => {
    if (!opts?.skipContactScope) {
      const contact = await t.contact.findFirst({ where: { id: input.contactId, ...contactScope(actor) }, select: { id: true } });
      if (!contact) throw new ForbiddenError("Müşteri bulunamadı ya da erişiminiz yok.");
    }
    if (input.ownerId && input.ownerId !== actor.id) assertCan(actor, "opportunities.assign");
    const ownerId = input.ownerId ?? actor.id;
    const o = await t.opportunity.create({
      data: {
        title: input.title.trim(),
        contactId: input.contactId,
        source: input.source,
        stage: "NEW",
        position: await topPosition(t, "NEW"),
        ownerId,
        fireplaceType: input.fireplaceType ?? null,
        productCategory: input.productCategory?.trim() || null,
        productModel: input.productModel?.trim() || null,
        city: input.city?.trim() || null,
        district: input.district?.trim() || null,
        message: input.message?.trim() || null,
        estimatedAmount: input.estimatedAmount || null,
        currency: input.currency,
        expectedCloseDate: input.expectedCloseDate ?? null,
        nextActionAt: input.nextActionAt ?? null,
        nextActionNote: input.nextActionNote?.trim() || null,
        createdById: actor.id,
      },
    });
    await t.opportunityStageHistory.create({ data: { opportunityId: o.id, toStage: "NEW", changedById: actor.id } });
    await t.activity.create({ data: { type: "SYSTEM", subject: `Fırsat açıldı: ${o.title}`, actorId: actor.id, contactId: o.contactId, opportunityId: o.id } });
    await audit({ actorId: actor.id, action: "opportunity_created", entityType: "opportunity", entityId: o.id, summary: o.title, after: redact({ ...o }) }, t);
    if (ownerId !== actor.id) {
      await notify({ userId: ownerId, type: "assignment", title: `Size yeni fırsat atandı: ${o.title}`, link: `/firsatlar/${o.id}` }, t);
    }
    return o;
  };
  return tx ? run(tx) : prisma.$transaction(run);
}

export async function updateOpportunity(actor: Actor, id: string, input: Omit<OpportunityInput, "contactId">) {
  assertCan(actor, "opportunities.edit");
  return prisma.$transaction(async (t) => {
    const before = await t.opportunity.findFirst({ where: { id, ...opportunityScope(actor) } });
    if (!before) throw new ForbiddenError("Fırsat bulunamadı ya da erişiminiz yok.");
    const data = {
      title: input.title.trim(),
      source: input.source,
      fireplaceType: input.fireplaceType ?? null,
      productCategory: input.productCategory?.trim() || null,
      productModel: input.productModel?.trim() || null,
      city: input.city?.trim() || null,
      district: input.district?.trim() || null,
      message: input.message?.trim() || null,
      estimatedAmount: input.estimatedAmount || null,
      currency: input.currency,
      expectedCloseDate: input.expectedCloseDate ?? null,
      nextActionAt: input.nextActionAt ?? null,
      nextActionNote: input.nextActionNote?.trim() || null,
    };
    const after = await t.opportunity.update({ where: { id }, data });
    const d = diff(before as unknown as Record<string, unknown>, data);
    if (d.changed.length) {
      await audit({ actorId: actor.id, action: "opportunity_updated", entityType: "opportunity", entityId: id, summary: `Değişen: ${d.changed.join(", ")}`, before: d.before, after: d.after }, t);
    }
    if (input.ownerId !== undefined && input.ownerId !== before.ownerId) {
      await assignOpportunityTx(t, actor, before, input.ownerId);
    }
    return after;
  });
}

async function assignOpportunityTx(t: Tx, actor: Actor, opp: { id: string; title: string; contactId: string; ownerId: string | null }, ownerId: string | null) {
  assertCan(actor, "opportunities.assign");
  if (ownerId) {
    const u = await t.user.findFirst({ where: { id: ownerId, status: "ACTIVE" }, select: { id: true } });
    if (!u) throw new Error("Seçilen kullanıcı aktif değil.");
  }
  await t.opportunity.update({ where: { id: opp.id }, data: { ownerId } });
  const names = await t.user.findMany({ where: { id: { in: [opp.ownerId, ownerId].filter(Boolean) as string[] } }, select: { id: true, name: true } });
  const nameOf = (uid: string | null) => names.find((n) => n.id === uid)?.name ?? "Atanmamış";
  await t.activity.create({
    data: { type: "ASSIGNMENT", subject: `Sorumlu: ${nameOf(opp.ownerId)} → ${nameOf(ownerId)}`, actorId: actor.id, contactId: opp.contactId, opportunityId: opp.id },
  });
  await audit({ actorId: actor.id, action: "opportunity_assigned", entityType: "opportunity", entityId: opp.id, before: { ownerId: opp.ownerId }, after: { ownerId } }, t);
  if (ownerId && ownerId !== actor.id) {
    await notify({ userId: ownerId, type: "assignment", title: `Size fırsat atandı: ${opp.title}`, link: `/firsatlar/${opp.id}` }, t);
  }
}

export async function assignOpportunity(actor: Actor, id: string, ownerId: string | null) {
  return prisma.$transaction(async (t) => {
    const opp = await t.opportunity.findFirst({ where: { id, ...opportunityScope(actor) } });
    if (!opp) throw new ForbiddenError("Fırsat bulunamadı ya da erişiminiz yok.");
    if (opp.ownerId === ownerId) return;
    await assignOpportunityTx(t, actor, opp, ownerId);
  });
}

/**
 * Aşama değişimi + kanban sırası. LOST için kayıp nedeni zorunlu. Geçmiş ve zaman çizelgesine yazılır.
 * beforeId/afterId: hedef kolonda bırakılan konumun komşuları (sıra hesabı için).
 */
export async function moveOpportunity(
  actor: Actor,
  id: string,
  toStage: OpportunityStage,
  opts: { beforeId?: string | null; afterId?: string | null; lostReason?: string | null; lostNote?: string | null; note?: string | null } = {},
) {
  assertCan(actor, "opportunities.edit");
  return prisma.$transaction(async (t) => {
    const opp = await t.opportunity.findFirst({ where: { id, ...opportunityScope(actor) } });
    if (!opp) throw new ForbiddenError("Fırsat bulunamadı ya da erişiminiz yok.");
    if (toStage === "LOST" && opp.stage !== "LOST" && !opts.lostReason?.trim()) throw new Error("Kaybedildi aşaması için kayıp nedeni zorunlu.");

    const neighbours = await t.opportunity.findMany({
      where: { id: { in: [opts.beforeId, opts.afterId].filter(Boolean) as string[] }, stage: toStage, deletedAt: null },
      select: { id: true, position: true },
    });
    const prev = neighbours.find((n) => n.id === opts.beforeId)?.position;
    const next = neighbours.find((n) => n.id === opts.afterId)?.position;
    let position: number;
    if (prev !== undefined && next !== undefined) position = (prev + next) / 2;
    else if (prev !== undefined) position = prev + 1000;
    else if (next !== undefined) position = next - 1000;
    else position = opp.stage === toStage ? opp.position : await topPosition(t, toStage);

    const now = new Date();
    const stageChanged = opp.stage !== toStage;
    await t.opportunity.update({
      where: { id },
      data: {
        stage: toStage,
        position,
        ...(stageChanged && toStage === "WON" ? { wonAt: now, lostAt: null, lostReason: null, lostNote: null } : {}),
        ...(stageChanged && toStage === "LOST" ? { lostAt: now, wonAt: null, lostReason: opts.lostReason?.trim(), lostNote: opts.lostNote?.trim() || null } : {}),
        ...(stageChanged && toStage !== "WON" && toStage !== "LOST" ? { wonAt: null, lostAt: null } : {}),
        ...(stageChanged && ["CONTACTED", "NEEDS_ASSESSMENT"].includes(toStage) ? { lastContactAt: now } : {}),
      },
    });
    if (!stageChanged) return { stageChanged: false };

    await t.opportunityStageHistory.create({ data: { opportunityId: id, fromStage: opp.stage, toStage, changedById: actor.id, note: opts.note ?? opts.lostReason ?? null } });
    await t.activity.create({
      data: {
        type: "STAGE_CHANGE",
        subject: `${STAGE_LABELS[opp.stage]} → ${STAGE_LABELS[toStage]}`,
        body: toStage === "LOST" ? [opts.lostReason, opts.lostNote].filter(Boolean).join(" — ") : opts.note ?? null,
        actorId: actor.id,
        contactId: opp.contactId,
        opportunityId: id,
        metadata: { from: opp.stage, to: toStage },
      },
    });
    await audit({ actorId: actor.id, action: "opportunity_stage", entityType: "opportunity", entityId: id, summary: `${code.opportunity(opp.number)} ${opp.stage} → ${toStage}`, before: { stage: opp.stage }, after: { stage: toStage, lostReason: opts.lostReason ?? null } }, t);
    if (opp.ownerId && opp.ownerId !== actor.id) {
      await notify({ userId: opp.ownerId, type: "stage", title: `${opp.title}: ${STAGE_LABELS[toStage]}`, link: `/firsatlar/${id}` }, t);
    }
    return { stageChanged: true };
  });
}

export async function archiveOpportunity(actor: Actor, id: string) {
  assertCan(actor, "opportunities.delete");
  await prisma.$transaction(async (t) => {
    const o = await t.opportunity.findFirst({ where: { id, ...opportunityScope(actor) }, select: { id: true, title: true } });
    if (!o) throw new ForbiddenError("Fırsat bulunamadı ya da erişiminiz yok.");
    await t.opportunity.update({ where: { id }, data: { deletedAt: new Date() } });
    await audit({ actorId: actor.id, action: "opportunity_deleted", entityType: "opportunity", entityId: id, summary: o.title }, t);
  });
}
