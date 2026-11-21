/**
 * Instagram DM senkronu — elle çalıştırma / kurulum kontrolü (sunucuda, CRM klasöründe).
 *
 *   npx tsx --conditions=react-server scripts/instagram-sync.ts            # durum (salt okunur, ağ çağrısı yok)
 *   npx tsx --conditions=react-server scripts/instagram-sync.ts --check    # Graph alan kontrolü (salt okunur; yalnız sayılar)
 *   npx tsx --conditions=react-server scripts/instagram-sync.ts --apply    # tek senkron turu (worker ile aynı kilit)
 *
 * Token, mesaj içeriği, kullanıcı adı ve kimlikler YAZDIRILMAZ.
 */
import "dotenv/config";
import { hostname } from "node:os";

async function main() {
  const { prisma } = await import("@/lib/db");
  const { checkInstagramFields, instagramSyncConfig, readSyncState, syncInstagramConversations } = await import("@/lib/services/instagram-sync");
  try {
    if (!instagramSyncConfig()) {
      console.log("Yapılandırılmadı: META_ACCESS_TOKEN ve INSTAGRAM_ACCOUNT_ID gerekli.");
      return;
    }
    if (process.argv.includes("--check")) {
      console.log(JSON.stringify(await checkInstagramFields(), null, 2));
    } else if (process.argv.includes("--apply")) {
      console.log(JSON.stringify(await syncInstagramConversations({ owner: `manual:${hostname()}:${process.pid}` }), null, 2));
    }
    const s = await readSyncState();
    const conn = await prisma.integrationConnection.findUnique({ where: { provider: "INSTAGRAM_DM" }, select: { status: true, lastSyncAt: true } });
    const igCount = await prisma.conversation.count({ where: { channel: "INSTAGRAM" } });
    const igMsgs = await prisma.message.count({ where: { conversation: { channel: "INSTAGRAM" } } });
    console.log(
      JSON.stringify(
        {
          status: conn?.status ?? "yok",
          lastSyncAt: conn?.lastSyncAt ?? null,
          lastSuccessAt: s.lastSuccessAt ?? null,
          lastRunAt: s.lastRunAt ?? null,
          lastError: s.lastError ?? null,
          backoffUntil: s.backoffUntil ?? null,
          failures: s.failures ?? 0,
          trackedConversations: Object.keys(s.conversations ?? {}).length,
          knownBusinessIds: s.self?.ids?.length ?? 0,
          lastStats: s.lastStats ?? null,
          crmInstagramConversations: igCount,
          crmInstagramMessages: igMsgs,
        },
        null,
        2,
      ),
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message.slice(0, 300) : "hata");
  process.exit(1);
});
