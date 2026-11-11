/**
 * Site → CRM mutabakatı (kaçan aktarımları yeniden gönderir). Bayrak kapalıysa hiçbir şey yapmaz.
 *
 *   npm run crm:forward                    → son 72 saat, eksikleri gönder
 *   npm run crm:forward -- --since=24      → son 24 saat
 *   npm run crm:forward -- --dry-run       → yalnız say, gönderme
 *   npm run crm:forward -- --check         → yalnız bağlantı/sır testi (kişisel veri gönderilmez)
 *
 * Sunucuda cron: every 10 min → cd /var/www/bifire && npm run crm:forward >> logs/crm-forward.log 2>&1
 * Çıktıda kişisel veri yoktur (yalnız sayılar ve talep kimlikleri).
 */
import "dotenv/config";
import { prisma } from "@/lib/db";
import { checkCrmConnection, reconcileWithCrm } from "@/lib/crm/forward";

async function main() {
  if (process.argv.includes("--check")) {
    const c = await checkCrmConnection();
    console.log(c.enabled ? `[crm-forward] bağlantı ${c.ok ? "BAŞARILI" : "BAŞARISIZ"} (${c.status ?? "-"}${c.error ? " " + c.error : ""})` : "[crm-forward] kapalı (CRM_FORWARD_ENABLED != true).");
    if (c.enabled && !c.ok) process.exitCode = 1;
    return;
  }
  const sinceArg = process.argv.find((a) => a.startsWith("--since="));
  const sinceHours = Math.min(Math.max(Number(sinceArg?.split("=")[1] ?? 72) || 72, 1), 24 * 30);
  const dryRun = process.argv.includes("--dry-run");
  const r = await reconcileWithCrm({ sinceHours, dryRun });
  if (!r.enabled) {
    console.log("[crm-forward] kapalı (CRM_FORWARD_ENABLED != true) — işlem yapılmadı.");
    return;
  }
  console.log(`[crm-forward] ${new Date().toISOString()} son ${sinceHours} sa: kontrol=${r.checked} eksik=${r.missing} gönderilen=${r.sent} hata=${r.failed}${dryRun ? " (dry-run)" : ""}`);
  if (r.failed) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error("[crm-forward] hata:", e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
