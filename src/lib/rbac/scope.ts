import type { Prisma } from "@prisma/client";
import type { Permission } from "./permissions";

/**
 * Satır düzeyi görünürlük. Her liste/detay sorgusu bu filtrelerle yapılır; arayüzde gizlemek yeterli değildir.
 * "*.view_all" izni olmayan kullanıcı yalnız kendisine bağlı kayıtları görür:
 *  - Müşteri: sahibi / fırsatının sahibi / projesinde sorumlu-teknik-montaj / kendisine atanmış görevi var.
 *  - Fırsat: sahibi ya da fırsata bağlı projede görevli.
 *  - Proje: sahibi, teknik sorumlusu, montaj sorumlusu ya da bağlı fırsatın sahibi.
 *  - Görev: atanan ya da oluşturan.
 */
export type ScopeActor = { id: string; perms: ReadonlySet<Permission> };

const projectMember = (uid: string): Prisma.ProjectWhereInput => ({
  OR: [{ ownerId: uid }, { technicalUserId: uid }, { installationUserId: uid }],
});

export function contactScope(a: ScopeActor): Prisma.ContactWhereInput {
  const base: Prisma.ContactWhereInput = { deletedAt: null };
  if (!a.perms.has("contacts.view") && !a.perms.has("contacts.view_all")) return { id: { in: [] } };
  if (a.perms.has("contacts.view_all")) return base;
  return {
    ...base,
    OR: [
      { ownerId: a.id },
      { opportunities: { some: { ownerId: a.id, deletedAt: null } } },
      { projects: { some: { deletedAt: null, ...projectMember(a.id) } } },
      { tasks: { some: { assigneeId: a.id, deletedAt: null } } },
    ],
  };
}

export function opportunityScope(a: ScopeActor): Prisma.OpportunityWhereInput {
  const base: Prisma.OpportunityWhereInput = { deletedAt: null };
  if (!a.perms.has("opportunities.view") && !a.perms.has("opportunities.view_all")) return { id: { in: [] } };
  if (a.perms.has("opportunities.view_all")) return base;
  return {
    ...base,
    OR: [{ ownerId: a.id }, { projects: { some: { deletedAt: null, ...projectMember(a.id) } } }],
  };
}

export function projectScope(a: ScopeActor): Prisma.ProjectWhereInput {
  const base: Prisma.ProjectWhereInput = { deletedAt: null };
  if (!a.perms.has("projects.view") && !a.perms.has("projects.view_all")) return { id: { in: [] } };
  if (a.perms.has("projects.view_all")) return base;
  return {
    ...base,
    OR: [...(projectMember(a.id).OR ?? []), { opportunity: { ownerId: a.id } }],
  };
}

export function taskScope(a: ScopeActor): Prisma.TaskWhereInput {
  const base: Prisma.TaskWhereInput = { deletedAt: null };
  if (a.perms.has("tasks.view_all")) return base;
  return { ...base, OR: [{ assigneeId: a.id }, { createdById: a.id }] };
}

/** Teklif: quotes.view + teklifin fırsatına ya da (fırsatsızsa) müşterisine erişim. */
export function quoteScope(a: ScopeActor): Prisma.QuoteWhereInput {
  const base: Prisma.QuoteWhereInput = { deletedAt: null };
  if (!a.perms.has("quotes.view")) return { id: { in: [] } };
  if (a.perms.has("opportunities.view_all") && a.perms.has("contacts.view_all")) return base;
  return {
    ...base,
    OR: [{ opportunity: opportunityScope(a) }, { opportunityId: null, contact: contactScope(a) }],
  };
}

/** Randevu: tümü (calendar.view_all) ya da kendine atanmış / kendi oluşturduğu / erişebildiği fırsat-proje. */
export function appointmentScope(a: ScopeActor): Prisma.AppointmentWhereInput {
  if (!a.perms.has("calendar.view") && !a.perms.has("calendar.view_all")) return { id: { in: [] } };
  if (a.perms.has("calendar.view_all")) return {};
  return {
    OR: [{ assignedUserId: a.id }, { createdById: a.id }, { opportunity: { ownerId: a.id, deletedAt: null } }, { project: projectMember(a.id) }],
  };
}

/**
 * Yazışma: messages.view şart. Tüm müşterileri gören herkesi görür; diğerleri yalnız erişebildiği müşterinin,
 * kendisine atanmış ya da henüz müşteriye bağlanmamış (ekip gelen kutusu) yazışmaları görür.
 */
export function conversationScope(a: ScopeActor): Prisma.ConversationWhereInput {
  if (!a.perms.has("messages.view")) return { id: { in: [] } };
  if (a.perms.has("contacts.view_all")) return {};
  return { OR: [{ contactId: null }, { assignedUserId: a.id }, { contact: contactScope(a) }] };
}
