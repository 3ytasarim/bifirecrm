/**
 * YALNIZ GELİŞTİRME/STAGING: QA testinde oluşan kayıtları KİMLİKLE siler (liste sırasıyla asla).
 * Kapsam: @example.test e-postalı kullanıcılar + "QA " ile başlayan / @example.test e-postalı müşteriler ve bağlı kayıtları,
 * aynı kimlikteki talepler (leads) ve test istemcisinin "qa" önekli web olayları (gerçek site kimlikleri cuid: "c…").
 *
 *   npx tsx --conditions=react-server scripts/qa-cleanup.ts            # kuru çalıştırma (yalnız sayar)
 *   npx tsx --conditions=react-server scripts/qa-cleanup.ts --apply    # siler
 */
import "dotenv/config";
import { prisma } from "@/lib/db";
import { storage } from "@/lib/storage";

async function main() {
  if (process.env.APP_ENV === "production") throw new Error("QA temizliği production ortamında çalışmaz.");
  const apply = process.argv.includes("--apply");

  const users = await prisma.user.findMany({ where: { email: { endsWith: "@example.test" } }, select: { id: true, email: true } });
  const contacts = await prisma.contact.findMany({
    where: { OR: [{ primaryEmail: { endsWith: "@example.test" } }, { fullName: { startsWith: "QA " } }], NOT: { tags: { has: "demo" } } },
    select: { id: true, fullName: true },
  });
  const userIds = users.map((u) => u.id);
  const contactIds = contacts.map((c) => c.id);
  const opps = await prisma.opportunity.findMany({ where: { contactId: { in: contactIds } }, select: { id: true } });
  const oppIds = opps.map((o) => o.id);
  const leads = await prisma.lead.findMany({
    where: { OR: [{ contactId: { in: contactIds } }, { opportunityId: { in: oppIds } }, { name: { startsWith: "QA " } }, { email: { endsWith: "@example.test" } }, { source: { in: ["WEBSITE_CONTACT", "WEBSITE_QUOTE", "WEBSITE_SHOWROOM", "WEBSITE_DESIGN"] }, sourceSubmissionId: { startsWith: "qa" } }] },
    select: { id: true },
  });
  const leadIds = leads.map((l) => l.id);
  const events = await prisma.integrationEvent.findMany({ where: { provider: "BIFIRE_WEBSITE", OR: [{ externalEventId: { startsWith: "qa" } }, { leadId: { in: leadIds } }] }, select: { id: true } });
  const eventIds = events.map((e) => e.id);
  const files = await prisma.attachment.findMany({ where: { OR: [{ contactId: { in: contactIds } }, { opportunityId: { in: oppIds } }, { leadId: { in: leadIds } }] }, select: { id: true, storageKey: true, thumbnailKey: true } });
  const quotes = await prisma.quote.findMany({ where: { OR: [{ contactId: { in: contactIds } }, { opportunityId: { in: oppIds } }] }, select: { id: true, pdfAttachmentId: true } });
  const quoteIds = quotes.map((q) => q.id);
  const appointments = await prisma.appointment.findMany({ where: { OR: [{ contactId: { in: contactIds } }, { createdById: { in: userIds } }, { assignedUserId: { in: userIds } }] }, select: { id: true } });
  const appointmentIds = appointments.map((a) => a.id);
  const templates = await prisma.messageTemplate.findMany({ where: { name: { startsWith: "QA " } }, select: { id: true } });
  const templateIds = templates.map((t) => t.id);
  const ownerSetting = await prisma.setting.findUnique({ where: { key: "intake.website_owner_id" } });
  const ownerIsQa = typeof ownerSetting?.value === "string" && userIds.includes(ownerSetting.value);
  const entityIds = [...userIds, ...contactIds, ...oppIds, ...leadIds, ...quoteIds, ...appointmentIds, ...templateIds, ...files.map((f) => f.id)];

  console.log({ users: users.map((u) => u.email), contacts: contacts.map((c) => c.fullName), opportunities: oppIds.length, leads: leadIds.length, webEvents: eventIds.length, quotes: quoteIds.length, appointments: appointmentIds.length, templates: templateIds.length, files: files.length, ownerSetting: ownerIsQa });
  if (!apply) return console.log("Kuru çalıştırma. Silmek için --apply ekleyin.");

  const store = await storage();
  for (const f of files) {
    await store.delete(f.storageKey).catch(() => undefined);
    if (f.thumbnailKey) await store.delete(f.thumbnailKey).catch(() => undefined);
  }
  await prisma.$transaction([
    prisma.appointment.deleteMany({ where: { id: { in: appointmentIds } } }),
    prisma.messageTemplate.deleteMany({ where: { id: { in: templateIds } } }),
    prisma.quote.deleteMany({ where: { id: { in: quoteIds } } }),
    prisma.attachment.deleteMany({ where: { id: { in: files.map((f) => f.id) } } }),
    prisma.task.deleteMany({ where: { OR: [{ contactId: { in: contactIds } }, { opportunityId: { in: oppIds } }] } }),
    prisma.integrationJob.deleteMany({ where: { eventId: { in: eventIds } } }),
    prisma.integrationEvent.deleteMany({ where: { id: { in: eventIds } } }),
    prisma.lead.deleteMany({ where: { id: { in: leadIds } } }),
    prisma.project.deleteMany({ where: { contactId: { in: contactIds } } }),
    prisma.opportunity.deleteMany({ where: { id: { in: oppIds } } }),
    prisma.contact.deleteMany({ where: { id: { in: contactIds } } }),
    prisma.internalNotification.deleteMany({ where: { userId: { in: userIds } } }),
    prisma.auditLog.deleteMany({ where: { OR: [{ actorId: { in: userIds } }, { entityId: { in: entityIds } }] } }),
    prisma.setting.deleteMany({ where: ownerIsQa ? { key: "intake.website_owner_id" } : { key: "__none__" } }),
    prisma.user.deleteMany({ where: { id: { in: userIds } } }),
  ]);
  console.log("QA kayıtları silindi.");
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
