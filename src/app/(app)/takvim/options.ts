import "server-only";
import { prisma } from "@/lib/db";
import type { Actor } from "@/lib/rbac/assert";
import { opportunityScope, projectScope } from "@/lib/rbac/scope";
import { APPOINTMENT_STATUS_LABELS, APPOINTMENT_TYPE_LABELS } from "@/lib/labels";
import { code } from "@/lib/format";
import { userOptions } from "@/lib/queries";

const opts = (l: Record<string, string>) => Object.entries(l).map(([value, label]) => ({ value, label }));

/** Randevu formu seçenekleri: müşterinin erişilebilir fırsat/projeleri + kullanıcılar. */
export async function appointmentFormOptions(actor: Actor, contactId: string) {
  const [opportunities, projects, users] = await Promise.all([
    prisma.opportunity.findMany({ where: { contactId, ...opportunityScope(actor) }, orderBy: { createdAt: "desc" }, select: { id: true, number: true, title: true }, take: 50 }),
    prisma.project.findMany({ where: { contactId, ...projectScope(actor) }, orderBy: { createdAt: "desc" }, select: { id: true, number: true, name: true }, take: 50 }),
    userOptions(),
  ]);
  return {
    types: opts(APPOINTMENT_TYPE_LABELS),
    statuses: opts(APPOINTMENT_STATUS_LABELS),
    users,
    opportunities: opportunities.map((o) => ({ value: o.id, label: `${code.opportunity(o.number)} ${o.title}` })),
    projects: projects.map((p) => ({ value: p.id, label: `${code.project(p.number)} ${p.name}` })),
  };
}
