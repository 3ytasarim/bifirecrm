/**
 * YALNIZ GELİŞTİRME/STAGING: sahte demo verisi. Production'da çalışmaz.
 * Tüm demo kayıtları "demo" etiketi ve @example.test e-postaları taşır; --clear ile silinir.
 *
 *   npm run db:seed:demo            # ekle
 *   npm run db:seed:demo -- --clear # demo kayıtlarını sil
 */
import "dotenv/config";
import { prisma } from "@/lib/db";

const STAGES = ["NEW", "CONTACT_PENDING", "CONTACTED", "NEEDS_ASSESSMENT", "SHOWROOM_OR_SURVEY", "QUOTATION_PREPARING", "QUOTATION_SENT", "NEGOTIATION", "WON", "LOST"] as const;
const SOURCES = ["WEBSITE_QUOTE", "WEBSITE_SHOWROOM", "PHONE", "SHOWROOM", "REFERRAL", "INSTAGRAM_DM"] as const;
const NAMES = ["Demo Ayşe Yılmaz", "Demo Mehmet Kaya", "Demo Elif Demir", "Demo Can Öztürk", "Demo Zeynep Arslan", "Demo Burak Şahin", "Demo Selin Koç", "Demo Emre Aydın", "Demo Deniz Çelik", "Demo Ece Yıldız"];
const DISTRICTS = ["Tuzla", "Pendik", "Kartal", "Kadıköy", "Ataşehir", "Beşiktaş", "Sarıyer", "Çekmeköy", "Maltepe", "Üsküdar"];

async function clear() {
  const ids = (await prisma.contact.findMany({ where: { tags: { has: "demo" } }, select: { id: true } })).map((c) => c.id);
  await prisma.$transaction([
    prisma.task.deleteMany({ where: { contactId: { in: ids } } }),
    prisma.activity.deleteMany({ where: { contactId: { in: ids } } }),
    prisma.note.deleteMany({ where: { contactId: { in: ids } } }),
    prisma.project.deleteMany({ where: { contactId: { in: ids } } }),
    prisma.lead.deleteMany({ where: { contactId: { in: ids } } }),
    prisma.opportunity.deleteMany({ where: { contactId: { in: ids } } }),
    prisma.consentEvent.deleteMany({ where: { contactId: { in: ids } } }),
    prisma.contactChannel.deleteMany({ where: { contactId: { in: ids } } }),
    prisma.contact.deleteMany({ where: { id: { in: ids } } }),
  ]);
  console.log(`${ids.length} demo müşteri ve bağlı kayıtları silindi.`);
}

async function seed() {
  const owner = await prisma.user.findFirst({ where: { status: "ACTIVE" }, orderBy: { createdAt: "asc" } });
  for (let i = 0; i < NAMES.length; i++) {
    const [firstName, ...rest] = NAMES[i].split(" ");
    const phone = `+90532000${String(1000 + i).padStart(4, "0")}`;
    const email = `demo${i + 1}@example.test`;
    const c = await prisma.contact.create({
      data: {
        firstName,
        lastName: rest.join(" "),
        fullName: NAMES[i],
        primaryPhone: phone,
        primaryEmail: email,
        city: "İstanbul",
        district: DISTRICTS[i],
        source: SOURCES[i % SOURCES.length],
        tags: ["demo"],
        ownerId: owner?.id,
        channels: { create: [{ type: "PHONE", value: phone, normalized: phone, isPrimary: true }, { type: "EMAIL", value: email, normalized: email, isPrimary: true }] },
      },
    });
    const stage = STAGES[i % STAGES.length];
    const o = await prisma.opportunity.create({
      data: {
        title: `Demo — ${["L tipi odunlu", "Elektrikli 3D", "Bioethanol", "Bahçe şöminesi"][i % 4]} · ${DISTRICTS[i]}`,
        contactId: c.id,
        source: c.source,
        stage,
        position: i * 1000,
        ownerId: owner?.id,
        fireplaceType: (["WOOD", "ELECTRIC", "BIOETHANOL", "GARDEN"] as const)[i % 4],
        estimatedAmount: String(85000 + i * 15000),
        wonAt: stage === "WON" ? new Date() : null,
        lostAt: stage === "LOST" ? new Date() : null,
        lostReason: stage === "LOST" ? "Fiyat yüksek bulundu" : null,
        nextActionAt: new Date(Date.now() + (i - 3) * 86400_000),
        stageHistory: { create: { toStage: stage } },
      },
    });
    await prisma.task.create({ data: { title: `Demo dönüş: ${NAMES[i]}`, priority: i % 3 === 0 ? "HIGH" : "NORMAL", dueAt: new Date(Date.now() + (i - 4) * 86400_000), assigneeId: owner?.id, contactId: c.id, opportunityId: o.id } });
  }
  console.log(`${NAMES.length} demo müşteri + fırsat + görev eklendi (etiket: demo).`);
}

async function main() {
  if (process.env.APP_ENV === "production") throw new Error("Demo verisi production ortamına yüklenemez.");
  if (process.argv.includes("--clear")) await clear();
  else await seed();
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
