import "server-only";
import { prisma } from "@/lib/db";
import { ForbiddenError, type Actor } from "@/lib/rbac/assert";
import { contactScope, opportunityScope, projectScope } from "@/lib/rbac/scope";

export type RecordRef = { kind: "contact" | "opportunity" | "project"; id: string };

export type ResolvedRecord = { contactId: string; opportunityId: string | null; projectId: string | null; path: string };

/** Kayda erişim kontrolü + bağlı müşteri/fırsat kimlikleri. Erişim yoksa ForbiddenError. */
export async function resolveRecord(actor: Actor, ref: RecordRef): Promise<ResolvedRecord> {
  if (!/^[0-9a-f-]{36}$/i.test(ref.id)) throw new ForbiddenError("Kayıt bulunamadı ya da erişiminiz yok.");
  if (ref.kind === "contact") {
    const c = await prisma.contact.findFirst({ where: { id: ref.id, ...contactScope(actor) }, select: { id: true } });
    if (!c) throw new ForbiddenError("Kayıt bulunamadı ya da erişiminiz yok.");
    return { contactId: c.id, opportunityId: null, projectId: null, path: `/musteriler/${c.id}` };
  }
  if (ref.kind === "opportunity") {
    const o = await prisma.opportunity.findFirst({ where: { id: ref.id, ...opportunityScope(actor) }, select: { id: true, contactId: true } });
    if (!o) throw new ForbiddenError("Kayıt bulunamadı ya da erişiminiz yok.");
    return { contactId: o.contactId, opportunityId: o.id, projectId: null, path: `/firsatlar/${o.id}` };
  }
  const p = await prisma.project.findFirst({ where: { id: ref.id, ...projectScope(actor) }, select: { id: true, contactId: true, opportunityId: true } });
  if (!p) throw new ForbiddenError("Kayıt bulunamadı ya da erişiminiz yok.");
  return { contactId: p.contactId, opportunityId: p.opportunityId, projectId: p.id, path: `/projeler/${p.id}` };
}

/** Kayıt sayfasında gösterilecek ilişki filtresi: müşteri sayfası tüm bağlı fırsat/projelerin olaylarını da gösterir. */
export function relationWhere(ref: RecordRef) {
  if (ref.kind === "contact") return { contactId: ref.id };
  if (ref.kind === "opportunity") return { opportunityId: ref.id };
  return { projectId: ref.id };
}

export async function timeline(ref: RecordRef, take = 100) {
  const where = relationWhere(ref);
  const [activities, notes] = await Promise.all([
    prisma.activity.findMany({ where, orderBy: { occurredAt: "desc" }, take }),
    prisma.note.findMany({ where: { ...where, deletedAt: null }, orderBy: [{ pinned: "desc" }, { createdAt: "desc" }], take }),
  ]);
  const actorIds = Array.from(new Set([...activities.map((a) => a.actorId), ...notes.map((n) => n.authorId)].filter(Boolean) as string[]));
  const users = actorIds.length ? await prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true } }) : [];
  const nameOf = (id: string | null) => users.find((u) => u.id === id)?.name ?? "Sistem";
  return {
    pinned: notes.filter((n) => n.pinned).map((n) => ({ ...n, authorName: nameOf(n.authorId) })),
    items: [
      ...activities.map((a) => ({ kind: "activity" as const, at: a.occurredAt, id: a.id, type: a.type, subject: a.subject, body: a.body, durationMin: a.durationMin, actorName: nameOf(a.actorId) })),
      ...notes.filter((n) => !n.pinned).map((n) => ({ kind: "note" as const, at: n.createdAt, id: n.id, body: n.body, authorId: n.authorId, actorName: nameOf(n.authorId), edited: n.updatedAt.getTime() - n.createdAt.getTime() > 1000 })),
    ].sort((a, b) => b.at.getTime() - a.at.getTime()),
  };
}
