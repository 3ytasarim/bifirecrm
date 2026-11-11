import { prisma } from "@/lib/db";
import { notify } from "@/lib/notifications";

const ISTANBUL_DAY = (d: Date) => new Date(d.getTime() + 3 * 3600_000).toISOString().slice(0, 10);

/**
 * Worker tarafından dakikada bir çalışır:
 *  1) Hatırlatma zamanı gelen görevler → atanana iç bildirim (tekrar aralığı varsa tekrar).
 *  2) Geciken görevler → atanana günde bir bildirim.
 *  3) 24 saati aşan gecikme → yöneticilere (MANAGER/SUPER_ADMIN) eskalasyon, görev başına bir kez.
 */
export async function runReminderScan(now = new Date()) {
  let reminded = 0;
  let overdue = 0;
  let escalated = 0;

  const dueReminders = await prisma.task.findMany({
    where: { deletedAt: null, status: { in: ["OPEN", "IN_PROGRESS"] }, assigneeId: { not: null }, remindAt: { lte: now } },
    select: { id: true, title: true, assigneeId: true, remindAt: true, repeatMinutes: true, lastRemindedAt: true },
    take: 500,
  });
  for (const t of dueReminders) {
    const last = t.lastRemindedAt?.getTime() ?? 0;
    const due = t.repeatMinutes ? last + t.repeatMinutes * 60_000 <= now.getTime() : last === 0;
    if (!due) continue;
    await notify({ userId: t.assigneeId!, type: "task_reminder", title: `Hatırlatma: ${t.title}`, link: `/gorevler?id=${t.id}`, dedupeKey: `remind:${t.id}:${now.toISOString().slice(0, 16)}` });
    await prisma.task.update({ where: { id: t.id }, data: { lastRemindedAt: now } });
    reminded++;
  }

  const overdueTasks = await prisma.task.findMany({
    where: { deletedAt: null, status: { in: ["OPEN", "IN_PROGRESS"] }, dueAt: { lt: now } },
    select: { id: true, title: true, assigneeId: true, dueAt: true, escalatedAt: true, assignee: { select: { name: true } } },
    take: 1000,
  });
  const managers = overdueTasks.some((t) => !t.escalatedAt && now.getTime() - t.dueAt!.getTime() > 24 * 3600_000)
    ? await prisma.user.findMany({ where: { status: "ACTIVE", role: { in: ["MANAGER", "SUPER_ADMIN"] } }, select: { id: true } })
    : [];
  for (const t of overdueTasks) {
    if (t.assigneeId) {
      await notify({ userId: t.assigneeId, type: "task_overdue", title: `Geciken görev: ${t.title}`, link: `/gorevler?id=${t.id}`, dedupeKey: `overdue:${t.id}:${ISTANBUL_DAY(now)}` });
      overdue++;
    }
    if (!t.escalatedAt && now.getTime() - t.dueAt!.getTime() > 24 * 3600_000) {
      for (const m of managers) {
        if (m.id === t.assigneeId) continue;
        await notify({ userId: m.id, type: "task_escalation", title: `24 saati aşan gecikme: ${t.title}`, body: t.assignee ? `Sorumlu: ${t.assignee.name}` : "Sorumlu atanmamış", link: `/gorevler?id=${t.id}`, dedupeKey: `escalate:${t.id}` });
      }
      await prisma.task.update({ where: { id: t.id }, data: { escalatedAt: now } });
      escalated++;
    }
  }
  return { reminded, overdue, escalated };
}
