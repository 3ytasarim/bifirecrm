/**
 * QA (yalnız geliştirme DB'si): Instagram DM API senkronu — gerçek Meta hesabı OLMADAN, yerel sahte Graph sunucusuyla.
 * Kayıtlar "qa" kimlikleriyle açılır (yazışma qa_igu_*, mesaj qa_mid_*, hesap kullanıcı adı qa_bifire).
 * Sonunda kendisi temizler; yine de kontrol için:  npx tsx --conditions=react-server scripts/qa-cleanup.ts
 *
 *   npx tsx --conditions=react-server scripts/qa-instagram-sync.ts
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { randomBytes } from "node:crypto";

const ACC = "qa_ig_acc";
const BIZ = "qa_biz_scoped"; // mesajlarda görünen işletme kimliği (hesap kimliğinden FARKLI)
const RUN = randomBytes(3).toString("hex");
const H = 3600_000;
const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString().replace("Z", "+0000");

type Msg = { id: string; created_time: string; from: { id: string; username?: string }; to: { data: { id: string; username?: string }[] }; message?: string; attachments?: { data: Record<string, unknown>[] } };
const cust = (n: number) => ({ id: `qa_igu_${RUN}_${n}`, username: `qa_musteri${n}` });
const biz = { id: BIZ, username: "qa_bifire" };
const inMsg = (id: string, n: number, msAgo: number, text?: string, extra: Partial<Msg> = {}): Msg => ({ id: `qa_mid_${RUN}_${id}`, created_time: iso(msAgo), from: cust(n), to: { data: [biz] }, ...(text ? { message: text } : {}), ...extra });
const outMsg = (id: string, n: number, msAgo: number, text: string): Msg => ({ id: `qa_mid_${RUN}_${id}`, created_time: iso(msAgo), from: biz, to: { data: [cust(n)] }, message: text });

// Sahte Graph verisi: Graph en yeniden eskiye döner; burada da öyle.
const convs: { id: string; updated_time: string; messages: Msg[] }[] = [
  { id: `qa_conv_${RUN}_1`, updated_time: iso(1 * H), messages: [inMsg("1a", 1, 1 * H, "QA fiyat alabilir miyim?"), outMsg("1b", 1, 1.5 * H, "QA tabii"), inMsg("1c", 1, 48 * H, "QA eski mesaj")] },
  { id: `qa_conv_${RUN}_2`, updated_time: iso(2 * H), messages: [inMsg("2a", 2, 2 * H, undefined, { attachments: { data: [{ image_data: { url: "https://example.test/x.jpg" } }] } })] },
  { id: `qa_conv_${RUN}_3`, updated_time: iso(3 * H), messages: [inMsg("3a", 3, 3 * H, "QA üçüncü görüşme")] },
];
let mode: "ok" | "500" | "190" | "100" = "ok";
let reject100Full = false;
const calls = { me: 0, conversations: 0, messages: 0 };

const server = createServer((req: IncomingMessage, res: ServerResponse) => {
  const url = new URL(req.url ?? "/", "http://x");
  const send = (code: number, body: unknown) => {
    res.writeHead(code, { "Content-Type": "application/json" });
    res.end(JSON.stringify(body));
  };
  if (req.headers.authorization !== "Bearer qa-meta-token") return send(401, { error: { message: "QA sahte: token yok", code: 190 } });
  const parts = url.pathname.split("/").filter(Boolean); // [v23.0, id, edge?]
  const [, id, edge] = parts;
  if (mode === "500") return send(500, { error: { message: "QA sahte sunucu hatası", code: 2 } });
  if (mode === "190") return send(400, { error: { message: "QA sahte: oturum süresi doldu", code: 190 } });
  if (id === ACC && !edge) {
    calls.me++;
    return send(200, { id: ACC, username: "qa_bifire" });
  }
  if (id === ACC && edge === "conversations") {
    calls.conversations++;
    if (url.searchParams.get("platform") !== "instagram") return send(400, { error: { message: "platform yok", code: 100 } });
    // Sayfa boyu 2 (sayfalama testi): after=p2 → ikinci sayfa.
    const sorted = [...convs].sort((a, b) => (a.updated_time < b.updated_time ? 1 : -1));
    const page = url.searchParams.get("after") === "p2" ? sorted.slice(2) : sorted.slice(0, 2);
    const more = url.searchParams.get("after") !== "p2" && sorted.length > 2;
    return send(200, { data: page.map((c) => ({ id: c.id, updated_time: c.updated_time })), paging: { cursors: { after: more ? "p2" : "end" }, ...(more ? { next: "https://graph.example.test/next" } : {}) } });
  }
  const c = convs.find((x) => x.id === id);
  if (c && edge === "messages") {
    calls.messages++;
    const fields = url.searchParams.get("fields") ?? "";
    if ((mode === "100" || reject100Full) && fields.includes("attachments")) return send(400, { error: { message: "QA sahte: geçersiz alan", code: 100 } });
    return send(200, { data: [...c.messages].sort((a, b) => (a.created_time < b.created_time ? 1 : -1)) });
  }
  send(404, { error: { message: "QA sahte: yok", code: 803 } });
});

let fails = 0;
const ok = (cond: unknown, msg: string) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`);
  if (!cond) fails++;
};

async function main() {
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const APP_SECRET = randomBytes(32).toString("hex");
  Object.assign(process.env, { META_APP_SECRET: APP_SECRET, META_VERIFY_TOKEN: "qa-verify", META_ACCESS_TOKEN: "qa-meta-token", META_GRAPH_VERSION: "v23.0", INSTAGRAM_ACCOUNT_ID: ACC, META_GRAPH_URL: base });
  await import("dotenv/config");
  if (process.env.APP_ENV === "production") throw new Error("production'da çalışmaz");

  const { prisma } = await import("@/lib/db");
  const { NextRequest } = await import("next/server");
  const { metaSignature } = await import("@/lib/integrations/meta-signature");
  const route = await import("@/app/api/v1/webhooks/meta/route");
  const { processBatch } = await import("@/lib/jobs/handlers");
  const sync = await import("@/lib/services/instagram-sync");

  // Gerçek bağlantı durumunu ezme: yalnız INSTAGRAM_DM satırı yokken çalışır, sonunda kendi satırını siler.
  if (await prisma.integrationConnection.count({ where: { provider: "INSTAGRAM_DM" } })) throw new Error("INSTAGRAM_DM bağlantı satırı zaten var; QA gerçek durumu ezmez.");
  const started = new Date();
  const thread = (n: number) => cust(n).id;
  const conv = (n: number) => prisma.conversation.findUnique({ where: { channel_externalThreadId: { channel: "INSTAGRAM", externalThreadId: thread(n) } }, include: { messages: { orderBy: { occurredAt: "asc" } } } });
  const countMid = (id: string) => prisma.message.count({ where: { externalMessageId: `qa_mid_${RUN}_${id}` } });
  const igMessages = () => prisma.message.count({ where: { conversation: { channel: "INSTAGRAM", externalThreadId: { startsWith: `qa_igu_${RUN}` } } } });
  const clearBackoff = () => prisma.$executeRaw`UPDATE integration_connections SET config = jsonb_set(config, '{igSync,backoffUntil}', 'null'::jsonb) WHERE provider = 'INSTAGRAM_DM'`;
  const webhook = async (m: Msg) => {
    const raw = JSON.stringify({ object: "instagram", entry: [{ id: ACC, time: Date.now(), messaging: [{ sender: { id: m.from.id }, recipient: { id: m.to.data[0].id }, timestamp: new Date(m.created_time.replace("+0000", "Z")).getTime(), message: { mid: m.id, text: m.message } }] }] });
    const res = await route.POST(new NextRequest("http://localhost:3720/api/v1/webhooks/meta", { method: "POST", body: raw, headers: { "content-type": "application/json", "x-hub-signature-256": metaSignature(APP_SECRET, raw), "x-forwarded-for": "203.0.113.9" } }));
    for (let i = 0; i < 5 && (await processBatch("qa-ig", 10)) > 0; i++);
    return res.status;
  };

  try {
    // ── Kilit
    ok(await sync.acquireSyncLock("qa-a"), "kilit: ilk alan alır");
    ok(!(await sync.acquireSyncLock("qa-b")), "kilit: ikinci alamaz");
    ok(await sync.acquireSyncLock("qa-b", new Date(Date.now() + 6 * 60_000)), "kilit: süresi dolan kira yeniden alınır");
    await sync.releaseSyncLock("qa-a"); // sahibi değil → bırakmaz
    ok(!(await sync.acquireSyncLock("qa-c")), "kilit: başkasının kilidi bırakılmaz");
    await sync.releaseSyncLock("qa-b");
    ok((await prisma.integrationConnection.findUnique({ where: { provider: "INSTAGRAM_DM" } }))?.status !== "ACTIVE", "senkrondan önce durum Aktif DEĞİL (anahtarların varlığı başarı sayılmaz)");

    // ── İlk senkron (2 sayfa)
    const r1 = await sync.syncInstagramConversations({ owner: "qa-1" });
    ok(r1.enabled && !r1.skipped && !r1.error && r1.conversations === 3 && r1.added === 5, `ilk senkron: 3 görüşme, 5 mesaj (${JSON.stringify(r1)})`);
    ok(calls.conversations === 2, "sayfalama: iki sayfa okundu");
    const c1 = await conv(1);
    ok(c1 && c1.messages.map((m) => m.direction).join(",") === "INBOUND,OUTBOUND,INBOUND", `yön + kronoloji: ${c1?.messages.map((m) => m.direction).join(",")}`);
    ok(c1?.displayName === "@qa_musteri1" && c1.externalThreadId === thread(1), "yazışma müşterinin kimliği + kullanıcı adıyla açıldı (işletme kimliği farklı olsa da)");
    ok(c1?.unreadCount === 1, `48 saatlik eski mesaj sessiz, yeni gelen okunmamış (unread=${c1?.unreadCount})`);
    ok(c1?.leadId, "tanınmayan müşteri için bekleyen talep açıldı");
    const c2 = await conv(2);
    ok(c2?.messages[0]?.body === "[Görsel]" && c2.messages[0].type === "image", "ek: görsel etiketlendi");
    const conn1 = await prisma.integrationConnection.findUnique({ where: { provider: "INSTAGRAM_DM" } });
    const st1 = await sync.readSyncState();
    ok(conn1?.status === "ACTIVE" && conn1.lastSyncAt && st1.lastSuccessAt, "başarılı API senkronundan sonra Aktif + son senkron zamanı");
    ok(st1.self?.ids.includes(BIZ) && st1.self.ids.includes(ACC), "işletmenin mesajlaşma kimliği öğrenildi");

    // ── Tekrar çalışan worker
    const m0 = calls.messages;
    const r2 = await sync.syncInstagramConversations({ owner: "qa-2" });
    ok(r2.enabled && !r2.skipped && r2.added === 0 && calls.messages === m0, `ikinci tur: değişmeyen görüşme okunmadı, yeni kayıt yok (${JSON.stringify(r2)})`);
    ok((await igMessages()) === 5, "toplam mesaj 5 (tekrar yok)");

    // ── Webhook önce, API sonra (aynı mid)
    const w1 = inMsg("3b", 3, 0.1 * H, "QA webhook + API");
    convs[2].messages.push(w1);
    convs[2].updated_time = iso(0.1 * H);
    ok((await webhook(w1)) === 200, "webhook 200");
    ok((await countMid("3b")) === 1, "webhook mesajı kaydetti");
    const r3 = await sync.syncInstagramConversations({ owner: "qa-3" });
    ok(r3.enabled && !r3.skipped && r3.added === 0 && r3.duplicates >= 1 && (await countMid("3b")) === 1, `webhook + API aynı mesaj: tek kayıt (${JSON.stringify(r3)})`);

    // ── API önce, webhook sonra
    const w2 = inMsg("2b", 2, 0.05 * H, "QA önce API");
    convs[1].messages.push(w2);
    convs[1].updated_time = iso(0.05 * H);
    const r4 = await sync.syncInstagramConversations({ owner: "qa-4" });
    ok(r4.enabled && !r4.skipped && r4.added === 1, "API yeni mesajı aldı");
    await webhook(w2);
    ok((await countMid("2b")) === 1, "API + webhook aynı mesaj: tek kayıt");

    // ── Eşzamanlı iki senkron
    convs[0].messages.push(inMsg("1d", 1, 0.02 * H, "QA eşzamanlı"));
    convs[0].updated_time = iso(0.02 * H);
    const [a, b] = await Promise.all([sync.syncInstagramConversations({ owner: "qa-p1" }), sync.syncInstagramConversations({ owner: "qa-p2" })]);
    const skipped = [a, b].filter((x) => x.enabled && x.skipped === "locked").length;
    ok(skipped === 1 && (await countMid("1d")) === 1, `eşzamanlı: biri kilitte bekledi, tek kayıt (${JSON.stringify([a, b])})`);

    // ── API hatası (5xx): mesaj silinmez, geri çekilme, durum Hata'ya çekilmez
    const before = await igMessages();
    convs[2].messages.push(inMsg("3c", 3, 0.01 * H, "QA hata sonrası"));
    convs[2].updated_time = iso(0.01 * H);
    mode = "500";
    const r5 = await sync.syncInstagramConversations({ owner: "qa-5" });
    const st5 = await sync.readSyncState();
    ok(r5.enabled && !r5.skipped && r5.error && (await igMessages()) === before, `5xx: hata raporlandı, mesaj silinmedi (${r5.enabled && !r5.skipped ? r5.error : ""})`);
    ok(st5.backoffUntil && new Date(st5.backoffUntil) > new Date() && st5.failures === 1, "5xx: geri çekilme başladı");
    ok((await prisma.integrationConnection.findUnique({ where: { provider: "INSTAGRAM_DM" } }))?.status === "ACTIVE", "5xx: geçici hata durumu Hata'ya çekmedi");
    const r6 = await sync.syncInstagramConversations({ owner: "qa-6" });
    ok(r6.enabled && r6.skipped === "backoff", "geri çekilme süresinde çağrı yapılmadı");
    mode = "ok";
    await clearBackoff();
    const r7 = await sync.syncInstagramConversations({ owner: "qa-7" });
    ok(r7.enabled && !r7.skipped && !r7.error && (await countMid("3c")) === 1 && (await sync.readSyncState()).failures === 0, "hata geçince eksik mesaj alındı, sayaç sıfırlandı");

    // ── Ek alanları desteklenmiyor (kod 100) → temel alanlarla devam
    reject100Full = true;
    convs[1].messages.push(inMsg("2c", 2, 0.005 * H, "QA temel alanlar"));
    convs[1].updated_time = iso(0.005 * H);
    const r8 = await sync.syncInstagramConversations({ owner: "qa-8" });
    ok(r8.enabled && !r8.skipped && !r8.error && (await countMid("2c")) === 1 && (await sync.readSyncState()).basicFieldsOnly === true, "kod 100: temel alanlarla devam edildi");

    // ── Anahtar hatası (190) → Hata + yönetici bildirimi
    mode = "190";
    convs[0].updated_time = iso(0.001 * H);
    const r9 = await sync.syncInstagramConversations({ owner: "qa-9" });
    const conn9 = await prisma.integrationConnection.findUnique({ where: { provider: "INSTAGRAM_DM" } });
    ok(r9.enabled && !r9.skipped && r9.error && conn9?.status === "ERROR" && /Instagram API senkronu/.test(conn9.lastError ?? ""), "190: bağlantı Hata durumuna alındı");
    ok((await igMessages()) === before + 2, "190: var olan mesajlar silinmedi (3c + 2c sonrası)");
    const log = JSON.stringify([r1, r2, r3, r4, r5, r7, r8, r9]);
    ok(!/qa-meta-token|QA fiyat|qa_musteri|qa_igu_/.test(log), "sonuç nesnelerinde token, içerik ve kimlik yok");
    mode = "ok";
  } finally {
    // Temizlik (kimlikle): QA yazışmaları, talepleri, olay/işleri, bildirimleri ve QA'nın açtığı bağlantı satırı.
    const qaConvs = await prisma.conversation.findMany({ where: { channel: "INSTAGRAM", externalThreadId: { startsWith: `qa_igu_${RUN}` } }, select: { id: true, leadId: true } });
    const convIds = qaConvs.map((c) => c.id);
    const leadIds = qaConvs.map((c) => c.leadId).filter((x): x is string => Boolean(x));
    const events = await prisma.integrationEvent.findMany({ where: { provider: "INSTAGRAM_DM", externalEventId: { startsWith: `ig:qa_mid_${RUN}` } }, select: { id: true } });
    await prisma.integrationJob.deleteMany({ where: { eventId: { in: events.map((e) => e.id) } } });
    await prisma.integrationEvent.deleteMany({ where: { id: { in: events.map((e) => e.id) } } });
    await prisma.internalNotification.deleteMany({ where: { OR: [{ link: { in: convIds.map((id) => `/mesajlar/${id}`) } }, { createdAt: { gte: started }, type: "integration_error", body: { contains: "QA sahte" } }] } });
    await prisma.conversation.deleteMany({ where: { id: { in: convIds } } });
    await prisma.auditLog.deleteMany({ where: { entityType: "lead", entityId: { in: leadIds } } });
    await prisma.lead.deleteMany({ where: { id: { in: leadIds } } });
    await prisma.integrationConnection.deleteMany({ where: { provider: "INSTAGRAM_DM", createdAt: { gte: started } } });
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
