/**
 * QA (yalnız geliştirme DB'si): WhatsApp 360dialog / coexistence — gerçek hesap OLMADAN, yerel sahte 360dialog
 * sunucusu + gerçek webhook ucu ile uçtan uca doğrulama. Sahte sunucu adresi (D360_API_URL) yalnız APP_ENV≠production.
 * Kendi açtığı yazışma/mesaj/olay/bağlantı satırlarını kimlikle siler; ardından yine de:
 *   npx tsx --conditions=react-server scripts/qa-cleanup.ts --apply
 *
 *   npx tsx --conditions=react-server scripts/qa-d360.ts
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import type { AddressInfo } from "node:net";

const API_KEY = `qa-d360-${randomBytes(8).toString("hex")}`;
const RUN = randomBytes(4).toString("hex");
const calls = { sends: [] as Record<string, unknown>[], templateGets: 0, badKey: 0, webhookPosts: [] as unknown[] };

const readBody = (req: IncomingMessage) =>
  new Promise<string>((r) => {
    let s = "";
    req.on("data", (c) => (s += c));
    req.on("end", () => r(s));
  });
const json = (res: ServerResponse, status: number, data: unknown) => {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://x");
  if (req.headers["d360-api-key"] !== API_KEY) {
    calls.badKey++;
    return json(res, 401, { error: { code: 0, message: "Invalid api key" } });
  }
  if (req.method === "GET" && url.pathname === "/message_templates") {
    calls.templateGets++;
    return json(res, 200, {
      data: [{ id: "qa_tpl_1", name: "qa_d360_bilgi", language: "tr", status: "APPROVED", category: "UTILITY", components: [{ type: "BODY", text: "Merhaba {{1}}, talebiniz alındı." }] }],
      paging: { cursors: { after: "x" } },
    });
  }
  if (req.method === "POST" && url.pathname === "/messages") {
    const b = JSON.parse(await readBody(req)) as Record<string, unknown>;
    calls.sends.push(b);
    return json(res, 200, { messaging_product: "whatsapp", contacts: [{ input: b.to, wa_id: b.to }], messages: [{ id: `wamid.qa_out_${RUN}_${calls.sends.length}`, message_status: "accepted" }] });
  }
  if (url.pathname === "/v1/configs/webhook") {
    if (req.method === "POST") {
      calls.webhookPosts.push(JSON.parse(await readBody(req)));
      return json(res, 201, { message: "ok" });
    }
    return json(res, 200, { url: "https://eski.example.test/hook", headers: {} });
  }
  json(res, 404, { error: { message: "not found" } });
});

let fails = 0;
const ok = (cond: unknown, msg: string) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`);
  if (!cond) fails++;
};

async function main() {
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const SECRET = randomBytes(32).toString("hex");
  const META_SECRET = randomBytes(32).toString("hex");
  Object.assign(process.env, {
    WHATSAPP_PROVIDER: "360dialog",
    D360_API_KEY: API_KEY,
    D360_WEBHOOK_SECRET: SECRET,
    D360_API_URL: base,
    WHATSAPP_PHONE_NUMBER_ID: "QAPN360",
    META_APP_SECRET: META_SECRET,
    META_VERIFY_TOKEN: "qa-verify",
  });
  await import("dotenv/config");
  if (process.env.APP_ENV === "production") throw new Error("production'da çalışmaz");

  const { NextRequest } = await import("next/server");
  const { prisma } = await import("@/lib/db");
  const { effectivePermissions } = await import("@/lib/rbac/permissions");
  const { metaSignature } = await import("@/lib/integrations/meta-signature");
  const route = await import("@/app/api/v1/webhooks/whatsapp-360dialog/route");
  const metaRoute = await import("@/app/api/v1/webhooks/meta/route");
  const { processBatch } = await import("@/lib/jobs/handlers");
  const ch = await import("@/lib/services/channels");

  if (await prisma.integrationConnection.count({ where: { provider: "WHATSAPP" } })) throw new Error("WHATSAPP bağlantı satırı zaten var; QA gerçek durumu ezmez.");
  if (await prisma.whatsappTemplate.count({ where: { NOT: { name: { startsWith: "qa_" } } } })) throw new Error("Gerçek WhatsApp şablonları var; şablon senkronu onları silinmiş işaretler. QA çalışmaz.");

  // QA numaraları (gerçek olmayan 90 555 000 xx xx aralığı) — temizlik bu kimliklerle yapılır.
  const rnd = () => String(1000 + Math.floor(Math.random() * 8999));
  const A = `90555000${rnd()}`; // canlı mesaj + telefondan yanıt
  const B = `90555001${rnd()}`; // yalnız geçmiş aktarımı
  const threads = [A, B];

  const drain = async () => {
    for (let i = 0; i < 10; i++) if ((await processBatch("qa-d360", 20, false)) === 0) return;
  };
  const post = (payload: unknown, token: string | null = SECRET) =>
    route.POST(
      new NextRequest("http://localhost:3720/api/v1/webhooks/whatsapp-360dialog", {
        method: "POST",
        body: JSON.stringify(payload),
        headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.9", ...(token !== null ? { "x-bifire-webhook-token": token } : {}) },
      }),
    );
  const envelope = (field: string, value: Record<string, unknown>) => ({
    object: "whatsapp_business_account",
    entry: [{ id: "QAWABA", changes: [{ field, value: { messaging_product: "whatsapp", metadata: { display_phone_number: "905550000000", phone_number_id: "QAPN360" }, ...value } }] }],
  });
  const conv = (waId: string) => prisma.conversation.findUnique({ where: { channel_externalThreadId: { channel: "WHATSAPP", externalThreadId: waId } }, include: { messages: { orderBy: { occurredAt: "asc" } } } });
  const now = Math.floor(Date.now() / 1000);

  try {
    // 1) Yetki
    ok((await post(envelope("messages", {}), null)).status === 401, "başlıksız istek → 401");
    ok((await post(envelope("messages", {}), "yanlis-token-0123456789abcdef0123456789")).status === 401, "yanlış token → 401");

    // 2) Müşteriden gelen mesaj
    const inbound = envelope("messages", { contacts: [{ profile: { name: `QA Coex ${RUN}` }, wa_id: A }], messages: [{ from: A, id: `wamid.qa_in_${RUN}`, timestamp: String(now - 60), type: "text", text: { body: "Merhaba, fiyat alabilir miyim?" } }] });
    const r1 = await post(inbound);
    ok(r1.status === 200, `gelen mesaj → 200 (${r1.status})`);
    await drain();
    let c = await conv(A);
    ok(c && c.messages.length === 1 && c.messages[0].direction === "INBOUND", "gelen mesaj yazışmaya düştü");
    ok(c?.unreadCount === 1, "okunmamış = 1");
    ok(c?.leadId, "tanınmayan numara → talep açıldı");

    // 3) Telefondaki uygulamadan yazılan yanıt (smb_message_echoes)
    const echo = envelope("smb_message_echoes", { message_echoes: [{ from: "905550000000", to: A, id: `wamid.qa_echo_${RUN}`, timestamp: String(now - 30), type: "text", text: { body: "Merhaba, hemen yardımcı olalım." } }] });
    const r2 = await post(echo);
    ok(r2.status === 200, "echo → 200");
    await drain();
    c = await conv(A);
    const e = c?.messages.find((m) => m.externalMessageId === `wamid.qa_echo_${RUN}`);
    ok(e && e.direction === "OUTBOUND" && e.status === "SENT" && !e.sentById, "telefondan yanıt CRM'de giden mesaj (gönderen kullanıcı yok)");
    ok(c?.unreadCount === 1, "echo okunmamış sayısını artırmadı");
    ok((await prisma.lead.count({ where: { sourceSubmissionId: `conv:${c?.id}` } })) === 1, "echo yeni talep açmadı");
    const r2b = (await (await post(echo)).json()) as { duplicates: number };
    ok(r2b.duplicates === 1, "aynı echo ikinci kez → tekrar sayıldı, kayıt yok");

    // 4) Geçmiş aktarımı (history): yeni numara B + A'nın zaten var olan mesajı
    const history = {
      id: `qa_hist_${RUN}`,
      event: "history",
      data: {
        id: "QAWABA",
        messaging_product: "whatsapp",
        metadata: { display_phone_number: "905550000000", phone_number_id: "QAPN360" },
        history: [
          {
            metadata: { phase: 0, chunk_order: 0, progress: 100 },
            threads: [
              { id: B, messages: [
                { from: B, id: `wamid.qa_h1_${RUN}`, timestamp: String(now - 86400 * 3), type: "text", text: { body: "Geçen hafta konuştuğumuz şömine" }, history_context: { status: "READ" } },
                { from: "905550000000", to: B, id: `wamid.qa_h2_${RUN}`, timestamp: String(now - 86400 * 3 + 60), type: "text", text: { body: "Ölçüleri bekliyoruz" }, history_context: { status: "READ" } },
              ] },
              { id: A, messages: [{ from: A, id: `wamid.qa_in_${RUN}`, timestamp: String(now - 60), type: "text", text: { body: "Merhaba, fiyat alabilir miyim?" } }] },
            ],
          },
        ],
      },
    };
    const leadsBefore = await prisma.lead.count();
    ok((await post(history)).status === 200, "geçmiş aktarımı → 200");
    await drain();
    const cb = await conv(B);
    ok(cb?.messages.length === 2 && cb.messages[0].direction === "INBOUND" && cb.messages[1].direction === "OUTBOUND", "geçmiş: B'nin 2 mesajı doğru yönlerle");
    ok(cb?.unreadCount === 0, "geçmiş: okunmamış sayılmadı");
    ok((await prisma.lead.count()) === leadsBefore, "geçmiş: talep açılmadı");
    ok((await conv(A))?.messages.length === 2, "geçmiş: A'daki mevcut mesaj çiftlenmedi");
    const r4b = (await (await post(history)).json()) as { duplicates: number };
    ok(r4b.duplicates === 1, "aynı geçmiş parçası ikinci kez → tekrar");

    // 5) Rehber eşitlemesi: kabul edilir, CRM'e kayıt açılmaz
    const r5 = await post({ id: "DM3", event: "smb_app_state_sync", data: { id: "QAWABA", messaging_product: "whatsapp", metadata: {}, state_sync: [{ type: "contact", contact: { full_name: "QA Rehber", phone_number: B }, action: "add", metadata: { timestamp: String(now) } }] } });
    ok(r5.status === 200 && ((await r5.json()) as { accepted: number }).accepted === 0, "rehber eşitlemesi → 200, kayıt yok");

    // 6) Meta ucu, WhatsApp 360dialog'dayken WhatsApp olayını kabul etmez (çift kaynak olmasın)
    const raw = JSON.stringify(envelope("messages", { messages: [{ from: A, id: `wamid.qa_meta_${RUN}`, timestamp: String(now), type: "text", text: { body: "x" } }] }));
    const mr = await metaRoute.POST(new NextRequest("http://localhost:3720/api/v1/webhooks/meta", { method: "POST", body: raw, headers: { "content-type": "application/json", "x-hub-signature-256": metaSignature(META_SECRET, raw) } }));
    ok(mr.status === 200 && ((await mr.json()) as { accepted: number }).accepted === 0, "Meta ucu WhatsApp olayını yok saydı");

    // 7) Şablon senkronu + şablonla yanıt (360dialog API'si, D360-API-KEY başlığı)
    await ch.syncWhatsappTemplates();
    const tpl = await prisma.whatsappTemplate.findUnique({ where: { name_language: { name: "qa_d360_bilgi", language: "tr" } } });
    ok(tpl?.status === "APPROVED" && tpl.paramCount === 1 && calls.templateGets === 1, "şablonlar 360dialog'dan çekildi");
    const u = await prisma.user.upsert({ where: { email: "qa-d360@example.test" }, create: { email: "qa-d360@example.test", name: "QA D360", role: "MANAGER", status: "ACTIVE" }, update: {} });
    const actor = { id: u.id, email: u.email, name: u.name, role: u.role, status: u.status, mfaEnabled: false, perms: effectivePermissions(u.role, []) };
    const m = await ch.sendWhatsappTemplate(actor, { conversationId: c!.id, templateId: tpl!.id, params: ["QA Coex"] });
    await drain();
    const sent = await prisma.message.findUnique({ where: { id: m.id } });
    const s0 = calls.sends[0] as { to?: string; type?: string; template?: { name?: string }; messaging_product?: string } | undefined;
    ok(sent?.status === "SENT" && sent.externalMessageId?.startsWith("wamid.qa_out_"), "şablon 360dialog'dan gönderildi, wamid kaydedildi");
    ok(s0?.to === A && s0.type === "template" && s0.template?.name === "qa_d360_bilgi" && s0.messaging_product === "whatsapp", "gönderim gövdesi Cloud API biçiminde");

    // 8) Durum bildirimi gönderilen mesajı günceller
    await post(envelope("messages", { statuses: [{ id: sent!.externalMessageId, status: "delivered", timestamp: String(now), recipient_id: A }] }));
    await drain();
    ok((await prisma.message.findUnique({ where: { id: m.id } }))?.status === "DELIVERED", "durum: İletildi");

    // 9) Sağlık kontrolü
    const h = await ch.metaHealthCheck();
    const connRow = await prisma.integrationConnection.findUnique({ where: { provider: "WHATSAPP" } });
    ok(h.WHATSAPP === "ok" && connRow?.status === "ACTIVE" && (connRow.config as { provider?: string } | null)?.provider === "360dialog", "sağlık kontrolü: 360dialog bağlantısı aktif");
    const badBefore = calls.badKey;
    process.env.D360_API_KEY = "yanlis";
    // env() önbellekli olduğundan anahtar hatasını doğrudan istemciyle dene
    const { d360Request } = await import("@/lib/integrations/whatsapp-client");
    let authErr = false;
    try {
      await d360Request("message_templates", { apiKey: "yanlis" });
    } catch (err) {
      authErr = (err as { auth?: boolean }).auth === true;
    }
    ok(authErr && calls.badKey === badBefore + 1, "yanlış API anahtarı → yetki hatası (bağlantı 'Hata'ya alınır)");
    process.env.D360_API_KEY = API_KEY;

    // 10) Webhook kayıt betiği: kuru çalıştırma durum gösterir; http adrese --apply reddedilir; sır ekrana basılmaz
    // Ayrı süreç (sahte sunucu bu süreçte; senkron çalıştırma onu kilitler).
    const runScript = (args: string[], extra: Record<string, string> = {}) =>
      new Promise<{ status: number | null; stdout: string; stderr: string }>((resolve) => {
        const p = spawn(process.execPath, ["--import", "tsx", "--conditions=react-server", "scripts/d360-webhook.ts", ...args], { env: { ...process.env, ...extra } });
        let stdout = "";
        let stderr = "";
        p.stdout.on("data", (c) => (stdout += c));
        p.stderr.on("data", (c) => (stderr += c));
        p.on("close", (status) => resolve({ status, stdout, stderr }));
      });
    const dry = await runScript([]);
    if (dry.status !== 0) console.log(dry.stdout, dry.stderr);
    ok(dry.status === 0 && /Kayıtlı adres: https:\/\/eski\.example\.test\/hook/.test(dry.stdout) && /güncel DEĞİL/.test(dry.stdout), "betik: mevcut kaydı gösterdi, değiştirmedi");
    ok(!dry.stdout.includes(SECRET) && !dry.stdout.includes(API_KEY), "betik çıktısında sır yok");
    const httpApply = await runScript(["--apply"], { APP_URL: "http://localhost:3720" });
    ok(httpApply.status !== 0 && calls.webhookPosts.length === 0, "betik: http adrese kayıt reddedildi");
    const apply = await runScript(["--apply"], { APP_URL: "https://crm.example.test" });
    const wp = calls.webhookPosts[0] as { url?: string; headers?: Record<string, string> } | undefined;
    ok(apply.status === 0 && wp?.url === "https://crm.example.test/api/v1/webhooks/whatsapp-360dialog" && wp.headers?.["X-Bifire-Webhook-Token"] === SECRET, "betik: https adres + doğrulama başlığı kaydedildi");
  } finally {
    // Kimlikle temizlik: QA numaralarının yazışmaları (mesajlar cascade), talepleri, olayları, şablon, kullanıcı, bağlantı satırı.
    const convs = await prisma.conversation.findMany({ where: { channel: "WHATSAPP", externalThreadId: { in: threads } }, select: { id: true, leadId: true } });
    const leadIds = convs.map((x) => x.leadId).filter((x): x is string => Boolean(x));
    const evs = await prisma.integrationEvent.findMany({ where: { provider: "WHATSAPP", externalEventId: { contains: RUN } }, select: { id: true } });
    const msgIds = (await prisma.message.findMany({ where: { conversationId: { in: convs.map((x) => x.id) } }, select: { id: true } })).map((x) => x.id);
    const sendJobs = msgIds.length ? (await prisma.$queryRaw<{ id: string }[]>`SELECT id::text FROM integration_jobs WHERE type = 'whatsapp.send' AND payload->>'messageId' = ANY(${msgIds})`).map((j) => j.id) : [];
    await prisma.integrationJob.deleteMany({ where: { OR: [{ eventId: { in: evs.map((x) => x.id) } }, { id: { in: sendJobs } }] } });
    await prisma.integrationEvent.deleteMany({ where: { id: { in: evs.map((x) => x.id) } } });
    await prisma.internalNotification.deleteMany({ where: { link: { in: convs.map((x) => `/mesajlar/${x.id}`) } } }).catch(() => {});
    await prisma.conversation.deleteMany({ where: { id: { in: convs.map((x) => x.id) } } });
    await prisma.lead.deleteMany({ where: { id: { in: leadIds } } }).catch(() => {});
    await prisma.whatsappTemplate.deleteMany({ where: { name: "qa_d360_bilgi" } });
    await prisma.integrationConnection.deleteMany({ where: { provider: "WHATSAPP" } });
    console.log(`\nTemizlendi: ${convs.length} yazışma, ${leadIds.length} talep, ${evs.length} olay. Kalanlar için qa-cleanup çalıştırın.`);
    await prisma.$disconnect();
    server.close();
  }
  console.log(fails ? `\n${fails} FAIL` : "\nTümü PASS");
  process.exit(fails ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
