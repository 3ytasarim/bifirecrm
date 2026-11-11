import "server-only";
import type { TaskPriority, TaskStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { audit, diff } from "@/lib/audit";
import { notify } from "@/lib/notifications";
import { assertCan, ForbiddenError, type Actor } from "@/lib/rbac/assert";
import { contactScope, opportunityScope, projectScope, taskScope } from "@/lib/rbac/scope";

export type TaskInput = {
  title: string;
  description?: string | null;
  priority: TaskPriority;
  dueAt?: Date | null;
  remindAt?: Date | null;
  repeatMinutes?: number | null;
  assigneeId?: string | null;
  contactId?: string | null;
  opportunityId?: string | null;
  projectId?: string | null;
};

/** İlişkilendirilen kayıtlara erişim kontrolü (başkasının müşterisine görev bağlanamaz). */
async function assertLinks(actor: Actor, input: Pick<TaskInput, "contactId" | "opportunityId" | "projectId">) {
  const checks: Promise<unknown>[] = [];
  let contactId = input.contactId ?? null;
  if (input.opportunityId) {
    const o = await prisma.opportunity.findFirst({ where: { id: input.opportunityId, ...opportunityScope(actor) }, select: { contactId: true } });
    if (!o) throw new ForbiddenError("Fırsata erişiminiz yok.");
    contactId ??= o.contactId;
  }
  if (input.projectId) {
    const p = await prisma.project.findFirst({ where: { id: input.projectId, ...projectScope(actor) }, select: { contactId: true } });
    if (!p) throw new ForbiddenError("Projeye erişiminiz yok.");
    contactId ??= p.contactId;
  }
  if (input.contactId) {
    checks.push(
      prisma.contact.findFirst({ where: { id: input.contactId, ...contactScope(actor) }, select: { id: true } }).then((c) => {
        if (!c) throw new ForbiddenError("Müşteriye erişiminiz yok.");
      }),
    );
  }
  await Promise.all(checks);
  return contactId;
}

export async function createTask(actor: Actor, input: TaskInput) {
  assertCan(actor, "tasks.manage");
  const contactId = await assertLinks(actor, input);
  const assigneeId = input.assigneeId ?? actor.id;
  if (assigneeId !== actor.id) {
    const u = await prisma.user.findFirst({ where: { id: assigneeId, status: "ACTIVE" }, select: { id: true } });
    if (!u) throw new Error("Atanan kullanıcı aktif değil.");
  }
  return prisma.$transaction(async (t) => {
    const task = await t.task.create({
      data: {
        title: input.title.trim(),
        description: input.description?.trim() || null,
        priority: input.priority,
        dueAt: input.dueAt ?? null,
        remindAt: input.remindAt ?? null,
        repeatMinutes: input.repeatMinutes ?? null,
        assigneeId,
        createdById: actor.id,
        contactId,
        opportunityId: input.opportunityId ?? null,
        projectId: input.projectId ?? null,
      },
    });
    await t.activity.create({ data: { type: "TASK", subject: `Görev: ${task.title}`, actorId: actor.id, contactId, opportunityId: task.opportunityId, projectId: task.projectId, metadata: { taskId: task.id } } });
    await audit({ actorId: actor.id, action: "task_created", entityType: "task", entityId: task.id, summary: task.title }, t);
    if (assigneeId !== actor.id) {
      await notify({ userId: assigneeId, type: "task", title: `Size görev atandı: ${task.title}`, link: `/gorevler?id=${task.id}` }, t);
    }
    return task;
  });
}

export async function updateTask(actor: Actor, id: string, input: TaskInput & { status: TaskStatus }) {
  assertCan(actor, "tasks.manage");
  const before = await prisma.task.findFirst({ where: { id, ...taskScope(actor) } });
  if (!before) throw new ForbiddenError("Görev bulunamadı ya da erişiminiz yok.");
  const contactId = await assertLinks(actor, input);
  return prisma.$transaction(async (t) => {
    const now = new Date();
    const data = {
      title: input.title.trim(),
      description: input.description?.trim() || null,
      priority: input.priority,
      status: input.status,
      dueAt: input.dueAt ?? null,
      remindAt: input.remindAt ?? null,
      repeatMinutes: input.repeatMinutes ?? null,
      assigneeId: input.assigneeId ?? before.assigneeId,
      contactId,
      opportunityId: input.opportunityId ?? null,
      projectId: input.projectId ?? null,
    };
    const after = await t.task.update({
      where: { id },
      data: {
        ...data,
        ...(input.status === "DONE" && before.status !== "DONE" ? { completedAt: now, completedById: actor.id } : {}),
        ...(input.status !== "DONE" ? { completedAt: null, completedById: null } : {}),
        // Tarih ileri alınırsa gecikme/eskalasyon yeniden değerlendirilir.
        ...(before.dueAt?.getTime() !== data.dueAt?.getTime() ? { escalatedAt: null, lastRemindedAt: null } : {}),
      },
    });
    const d = diff(before as unknown as Record<string, unknown>, data);
    if (d.changed.length) {
      await audit({ actorId: actor.id, action: "task_updated", entityType: "task", entityId: id, summary: `Değişen: ${d.changed.join(", ")}`, before: d.before, after: d.after }, t);
    }
    if (data.assigneeId && data.assigneeId !== before.assigneeId && data.assigneeId !== actor.id) {
      await notify({ userId: data.assigneeId, type: "task", title: `Size görev atandı: ${after.title}`, link: `/gorevler?id=${id}` }, t);
    }
    return after;
  });
}

export async function setTaskStatus(actor: Actor, id: string, status: TaskStatus) {
  assertCan(actor, "tasks.manage");
  return prisma.$transaction(async (t) => {
    const task = await t.task.findFirst({ where: { id, ...taskScope(actor) } });
    if (!task) throw new ForbiddenError("Görev bulunamadı ya da erişiminiz yok.");
    if (task.status === status) return;
    await t.task.update({
      where: { id },
      data: { status, ...(status === "DONE" ? { completedAt: new Date(), completedById: actor.id } : { completedAt: null, completedById: null }) },
    });
    if (status === "DONE") {
      await t.activity.create({ data: { type: "TASK", subject: `Görev tamamlandı: ${task.title}`, actorId: actor.id, contactId: task.contactId, opportunityId: task.opportunityId, projectId: task.projectId, metadata: { taskId: id } } });
    }
    await audit({ actorId: actor.id, action: "task_updated", entityType: "task", entityId: id, before: { status: task.status }, after: { status } }, t);
  });
}

export async function deleteTask(actor: Actor, id: string) {
  assertCan(actor, "tasks.manage");
  const task = await prisma.task.findFirst({ where: { id, ...taskScope(actor) } });
  if (!task) throw new ForbiddenError("Görev bulunamadı ya da erişiminiz yok.");
  await prisma.$transaction(async (t) => {
    await t.task.update({ where: { id }, data: { deletedAt: new Date() } });
    await audit({ actorId: actor.id, action: "task_updated", entityType: "task", entityId: id, summary: `Silindi: ${task.title}` }, t);
  });
}
