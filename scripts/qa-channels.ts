/**
 * QA (yalnız geliştirme DB'si): Faz 4 kanalları — gerçek Meta/Google hesabı OLMADAN, yerel sahte API sunucusu +
 * gerçek imzalı webhook istekleriyle uçtan uca doğrulama. Sahte sunucu adresleri yalnız APP_ENV≠production'da geçerlidir.
 * Kayıtlar "QA " / @example.test / "qa" kimlikleriyle açılır; ardından mutlaka:
 *   npx tsx --conditions=react-server scripts/qa-cleanup.ts --apply
 *
 *   npx tsx --conditions=react-server scripts/qa-channels.ts
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createHash, randomBytes } from "node:crypto";
import type { AddressInfo } from "node:net";

// ── Sahte Meta Graph + Google sunucusu ─────────────────────────────
const mode = { metaExpired: false, googleRevoked: false };
const calls = { leadFetch: 0, sends: [] as unknown[], gInsert: 0, gPatch: 0, gDelete: 0 };
const gEvents = new Map<string, Record<string, unknown>>();
const VERIFIER_SEEN: string[] = [];

function body(req: IncomingMessage): Promise<string> {
  return new Promise((r) => {
    let s = "";
    req.on("data", (c) => (s += c));
    req.on("end", () => r(s));
  });
}
const json = (res: ServerResponse, status: number, data: unknown) => {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(data === null ? "" : JSON.stringify(data));
};
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://x");
  const p = url.pathname;
  const raw = await body(req);
  const auth = req.headers.authorization ?? "";
  // Graph
  if (p.startsWith("/v23.0/")) {
    if (!auth.startsWith("Bearer qa-")) return json(res, 401, { error: { message: "QA sahte: anahtar yok", code: 190 } });
    if (mode.metaExpired) return json(res, 401, { error: { message: "QA sahte: Error validating access token: Session has expired", code: 190, type: "OAuthException" } });
    const rest = p.slice("/v23.0/".length);
    if (rest === "me") return json(res, 200, { id: "1" });
    if (rest === "qa_lead_1") {
      calls.leadFetch++;
      return json(res, 200, {
        id: "qa_lead_1",
        created_time: "2026-11-12T08:00:00+0000",
        form_id: "qa_form",
        ad_name: "QA reklam",
        campaign_name: "QA kampanya",
        platform: "fb",
        field_data: [
          { name: "full_name", values: ["QA Meta Müşteri"] },
          { name: "phone_number", values: ["+905550001001"] },
          { name: "email", values: ["qa-meta@example.test"] },
          { name: "hangi_model_ile_ilgileniyorsunuz?", values: ["Ada şömine"] },
        ],
      });
    }
    if (rest === "qa_ig_user_1") return json(res, 200, { username: "qa_kullanici", name: "QA Instagram Kişi" });
    if (rest === "QAPN") return json(res, 200, { display_phone_number: "+90 555 000 0000", verified_name: "QA Bifire", quality_rating: "GREEN" });
    if (rest === "QAWABA/message_templates")
      return json(res, 200, {
        data: [
          { id: "t1", name: "qa_randevu_onay", language: "tr", status: "APPROVED", category: "UTILITY", components: [{ type: "BODY", text: "Merhaba {{1}}, keşif randevunuz {{2}} tarihinde." }] },
          { id: "t2", name: "qa_kampanya", language: "tr", status: "APPROVED", category: "MARKETING", components: [{ type: "BODY", text: "Kış kampanyası başladı!" }] },
          { id: "t3", name: "qa_gorselli", language: "tr", status: "APPROVED", category: "MARKETING", components: [{ type: "HEADER", format: "IMAGE" }, { type: "BODY", text: "x" }] },
          { id: "t4", name: "qa_bekleyen", language: "tr", status: "PENDING", category: "UTILITY", components: [{ type: "BODY", text: "Bekliyor" }] },
        ],
      });
    if (rest === "QAPN/messages" && req.method === "POST") {
      const b = JSON.parse(raw);
      calls.sends.push(b);
      if (b.to === "905550009999") return json(res, 400, { error: { message: "QA sahte: (#131026) Message undeliverable", code: 131026 } });
      return json(res, 200, { messages: [{ id: `wamid.qa_out_${calls.sends.length}` }] });
    }
    return json(res, 404, { error: { message: `QA sahte: bilinmeyen ${rest}`, code: 100 } });
  }
  // Google OAuth
  if (p === "/oauth/token") {
    const f = new URLSearchParams(raw);
    if (f.get("grant_type") === "authorization_code") {
      VERIFIER_SEEN.push(f.get("code_verifier") ?? "");
      if (f.get("code") !== "qa_code") return json(res, 400, { error: "invalid_grant" });
      return json(res, 200, { access_token: "qa-g-at", refresh_token: "qa-g-rt", expires_in: 3600, scope: "openid https://www.googleapis.com/auth/calendar.events email", id_token: `${b64({ alg: "none" })}.${b64({ email: "qa-google@example.test" })}.x` });
    }
    if (mode.googleRevoked) return json(res, 400, { error: "invalid_grant", error_description: "QA sahte: Token has been expired or revoked." });
    if (f.get("refresh_token") !== "qa-g-rt") return json(res, 400, { error: "invalid_grant" });
    return json(res, 200, { access_token: `qa-g-at-${Date.now()}`, expires_in: 3600 });
  }
  if (p === "/oauth/revoke") return json(res, 200, {});
  // Google Calendar
  const m = p.match(/^\/calendar\/v3\/calendars\/primary\/events(?:\/([a-v0-9]+))?$/);
  if (m) {
    if (!auth.startsWith("Bearer qa-g-at")) return json(res, 401, { error: { message: "QA sahte: yetkisiz" } });
    const id = m[1];
    if (!id && req.method === "GET") return json(res, 200, { items: [] });
    if (!id && req.method === "POST") {
      const ev = JSON.parse(raw);
      if (gEvents.has(ev.id)) return json(res, 409, { error: { message: "The requested identifier already exists." } });
      gEvents.set(ev.id, ev);
      calls.gInsert++;
      return json(res, 200, ev);
    }
    if (id && req.method === "PATCH") {
      if (!gEvents.has(id)) return json(res, 404, { error: { message: "Not Found" } });
      gEvents.set(id, { ...gEvents.get(id), ...JSON.parse(raw) });
      calls.gPatch++;
      return json(res, 200, gEvents.get(id));
    }
    if (id && req.method === "DELETE") {
      if (!gEvents.has(id)) return json(res, 410, { error: { message: "Resource has been deleted" } });
      gEvents.delete(id);
      calls.gDelete++;
      res.writeHead(204);
      return res.end();
    }
  }
  json(res, 404, { error: { message: `QA sahte: ${req.method} ${p}` } });
});

let fails = 0;
const ok = (cond: unknown, msg: string) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`);
  if (!cond) fails++;
};
async function rejects(p: Promise<unknown>, re: RegExp, msg: string) {
  try {
    await p;
    ok(false, `${msg} (hata bekleniyordu)`);
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    ok(re.test(m), `${msg} → "${m}"`);
  }
}

async function main() {
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const APP_SECRET = randomBytes(32).toString("hex");
  const VERIFY = `qa-verify-${randomBytes(8).toString("hex")}`;
  Object.assign(process.env, {
    META_APP_SECRET: APP_SECRET,
    META_VERIFY_TOKEN: VERIFY,
    META_ACCESS_TOKEN: "qa-meta-token",
    META_GRAPH_VERSION: "v23.0",
    INSTAGRAM_ACCOUNT_ID: "qa_ig_account",
    WHATSAPP_ACCESS_TOKEN: "qa-wa-token",
    WHATSAPP_PHONE_NUMBER_ID: "QAPN",
    WHATSAPP_BUSINESS_ACCOUNT_ID: "QAWABA",
    GOOGLE_CLIENT_ID: "qa-client",
    GOOGLE_CLIENT_SECRET: "qa-client-secret",
    META_GRAPH_URL: base,
    GOOGLE_OAUTH_URL: `${base}/oauth`,
    GOOGLE_API_URL: base,
    WEBSITE_HMAC_SECRET: randomBytes(32).toString("hex"),
  });
  await import("dotenv/config");
  if (process.env.APP_ENV === "production") throw new Error("production'da çalışmaz");

  const { NextRequest } = await import("next/server");
  const { prisma } = await import("@/lib/db");
  const { effectivePermissions } = await import("@/lib/rbac/permissions");
  const { metaSignature } = await import("@/lib/integrations/meta-signature");
  const route = await import("@/app/api/v1/webhooks/meta/route");
  const { processBatch } = await import("@/lib/jobs/handlers");
  const ch = await import("@/lib/services/channels");
  const cal = await import("@/lib/services/calendar-sync");
  const appts = await import("@/lib/services/appointments");
  const google = await import("@/lib/integrations/google");
  const { googleEventId } = await import("@/lib/integrations/channel-rules");
  type Actor = import("@/lib/rbac/assert").Actor;
  // Gerçek kanal durumunu asla ezme: QA yalnız hiç bağlantı satırı yokken çalışır ve sonunda kendi satırlarını siler.
  const CH = ["META_LEAD_ADS", "WHATSAPP", "INSTAGRAM_DM", "GOOGLE_CALENDAR"] as const;
  if (await prisma.integrationConnection.count({ where: { provider: { in: [...CH] } } })) throw new Error("Kanal bağlantı satırları zaten var; QA gerçek durumu ezmez.");
  if (await prisma.integrationCredential.count()) throw new Error("Kayıtlı Google kimlik bilgisi var; QA çalışmaz.");

  const drain = async () => {
    for (let i = 0; i < 10; i++) if ((await processBatch("qa-channels", 20, false)) === 0) return;
  };
  const actorFor = async (email: string, role: "SALES" | "MANAGER"): Promise<Actor> => {
    const u = await prisma.user.upsert({ where: { email }, create: { email, name: `QA ${role}`, role, status: "ACTIVE" }, update: {} });
    return { id: u.id, email: u.email, name: u.name, role: u.role, status: u.status, mfaEnabled: false, perms: effectivePermissions(u.role, []) };
  };
  const manager = await actorFor("qa-kanal-yonetici@example.test", "MANAGER");
  const sales = await actorFor("qa-kanal-satis@example.test", "SALES");
  const prevOwner = await prisma.setting.findUnique({ where: { key: "intake.website_owner_id" } });
  if (prevOwner) throw new Error("intake.website_owner_id zaten tanımlı; QA bu ayarı ezmez.");
  await prisma.setting.create({ data: { key: "intake.website_owner_id", value: sales.id } });

  const post = (payload: unknown, sig?: string) => {
    const raw = JSON.stringify(payload);
    return route.POST(new NextRequest("http://localhost:3720/api/v1/webhooks/meta", { method: "POST", body: raw, headers: { "content-type": "application/json", "x-hub-signature-256": sig ?? metaSignature(APP_SECRET, raw), "x-forwarded-for": "203.0.113.7" } }));
  };

  // 1) Abonelik doğrulaması
  const v = await route.GET(new NextRequest(`http://localhost:3720/api/v1/webhooks/meta?hub.mode=subscribe&hub.verify_token=${VERIFY}&hub.challenge=qa12345`));
  ok(v.status === 200 && (await v.text()) === "qa12345", "GET doğrulama: doğru anahtar → challenge döner");
  const v2 = await route.GET(new NextRequest(`http://localhost:3720/api/v1/webhooks/meta?hub.mode=subscribe&hub.verify_token=yanlis&hub.challenge=qa12345`));
  ok(v2.status === 403, "GET doğrulama: yanlış anahtar → 403");

  // 2) Lead Ads: imza, tekil olay, tek işlem
  const leadgen = { object: "page", entry: [{ id: "qa_page", time: 1, changes: [{ field: "leadgen", value: { leadgen_id: "qa_lead_1", form_id: "qa_form", page_id: "qa_page" } }] }] };
  ok((await post(leadgen, "sha256=" + "0".repeat(64))).status === 401, "imzasız/yanlış imzalı istek → 401, olay yazılmaz");
  const r1 = await (await post(leadgen)).json();
  const r2 = await (await post(leadgen)).json();
  ok(r1.accepted === 1 && r2.duplicates === 1 && r2.accepted === 0, `aynı bildirim iki kez → 1 kabul, 1 tekrar (${JSON.stringify([r1, r2])})`);
  await drain();
  await post(leadgen); // işlendikten sonra Meta yeniden gönderirse
  await drain();
  const metaLeads = await prisma.lead.findMany({ where: { sourceSubmissionId: "qa_lead_1" }, include: { contact: true, opportunity: true } });
  ok(metaLeads.length === 1 && calls.leadFetch === 1, `reklam formu tek kez işlendi (lead=${metaLeads.length}, Graph çağrısı=${calls.leadFetch})`);
  const ml = metaLeads[0];
  ok(ml?.source === "FACEBOOK_LEAD_AD" && ml.status === "CONVERTED" && ml.contact?.primaryPhone === "+905550001001" && ml.contact?.kvkkNoticeAt === null, "lead → müşteri (+90555…), fırsat; KVKK varsayılmadı");
  ok(Boolean(ml?.message?.includes("hangi model ile ilgileniyorsunuz?: Ada şömine") && ml.opportunity?.title.includes("QA kampanya")), "serbest soru + kampanya fırsata yazıldı");
  ok((await prisma.integrationConnection.findUnique({ where: { provider: "META_LEAD_ADS" } }))?.status === "ACTIVE", "gerçek Graph yanıtı sonrası Lead Ads 'Aktif'");

  // 3) WhatsApp: tanınmayan kişi → bekleyen talep; tekrar → tek mesaj
  const waMsg = (id: string, from: string, name: string, text: string) => ({
    object: "whatsapp_business_account",
    entry: [{ id: "QAWABA", changes: [{ field: "messages", value: { metadata: { phone_number_id: "QAPN" }, contacts: [{ wa_id: from, profile: { name } }], messages: [{ from, id, timestamp: String(Math.floor(Date.now() / 1000)), type: "text", text: { body: text } }] } }] }],
  });
  await post(waMsg("wamid.qa_in_1", "905550002002", "QA WhatsApp Kişi", "Merhaba, fiyat alabilir miyim?"));
  await post(waMsg("wamid.qa_in_1", "905550002002", "QA WhatsApp Kişi", "Merhaba, fiyat alabilir miyim?"));
  await drain();
  const conv1 = await prisma.conversation.findUnique({ where: { channel_externalThreadId: { channel: "WHATSAPP", externalThreadId: "905550002002" } }, include: { messages: true, lead: true } });
  ok(conv1?.messages.length === 1 && conv1.unreadCount === 1 && conv1.phone === "+905550002002", "WhatsApp mesajı tek kez kaydedildi (okunmamış 1)");
  ok(conv1?.contactId === null && conv1.lead?.status === "RECEIVED" && conv1.lead.source === "WHATSAPP", "tanınmayan numara → müşteri açılmadı, 'Yeni' talep bekliyor");
  ok((await prisma.internalNotification.count({ where: { userId: sales.id, link: `/mesajlar/${conv1?.id}` } })) === 1, "sorumluya tek bildirim");

  // Tanınan müşteri: telefon eşleşmesi → yazışma müşteriye bağlanır + WHATSAPP kanalı
  const known = await prisma.contact.create({ data: { firstName: "QA", lastName: "Kayıtlı", fullName: "QA Kayıtlı Müşteri", primaryPhone: "+905550003003", ownerId: sales.id, kvkkNoticeAt: new Date() } });
  await post(waMsg("wamid.qa_in_2", "905550003003", "Profil Adı", "Keşif ne zaman?"));
  await drain();
  const conv2 = await prisma.conversation.findUnique({ where: { channel_externalThreadId: { channel: "WHATSAPP", externalThreadId: "905550003003" } } });
  const waChannel = await prisma.contactChannel.findFirst({ where: { contactId: known.id, type: "WHATSAPP" } });
  ok(conv2?.contactId === known.id && conv2.leadId === null && waChannel?.normalized === "+905550003003", "kayıtlı numara → yazışma müşteriye bağlandı, talep açılmadı");

  // 4) Instagram: gelen + kendi yanıtımız (echo) + başka hesaba ait olay yok sayılır
  const ig = (mid: string, from: string, to: string, text: string, echo = false) => ({ object: "instagram", entry: [{ id: "qa_ig_account", messaging: [{ sender: { id: from }, recipient: { id: to }, timestamp: Date.now(), message: { mid, text, ...(echo ? { is_echo: true } : {}) } }] }] });
  await post(ig("qa_mid_1", "qa_ig_user_1", "qa_ig_account", "Showroom adresi?"));
  await post(ig("qa_mid_2", "qa_ig_account", "qa_ig_user_1", "Merhaba, adresimiz …", true));
  await post(ig("qa_mid_3", "qa_ig_user_2", "baska_hesap", "yabancı"));
  await drain();
  const igc = await prisma.conversation.findUnique({ where: { channel_externalThreadId: { channel: "INSTAGRAM", externalThreadId: "qa_ig_user_1" } }, include: { messages: { orderBy: { occurredAt: "asc" } } } });
  ok(igc?.messages.length === 2 && igc.messages[0].direction === "INBOUND" && igc.messages[1].direction === "OUTBOUND" && igc.unreadCount === 1, "Instagram: 1 gelen + 1 yanıt (echo), okunmamış 1");
  ok(igc?.displayName === "@qa_kullanici (QA Instagram Kişi)", `Instagram görünen adı Graph'tan (${igc?.displayName})`);
  ok(!(await prisma.conversation.findUnique({ where: { channel_externalThreadId: { channel: "INSTAGRAM", externalThreadId: "qa_ig_user_2" } } })), "başka Instagram hesabına ait olay yok sayıldı");

  // Talep işlenince yazışma müşteriye bağlanır (Talepler › işle akışı)
  const { quickIntake } = await import("@/lib/services/intake");
  await quickIntake(manager, { name: "QA WhatsApp Kişi", phone: "+905550002002", source: "WHATSAPP", kvkkNotice: false, marketingConsent: false, contactChoice: "new", leadId: conv1!.leadId!, ownerId: sales.id });
  const conv1b = await prisma.conversation.findUnique({ where: { id: conv1!.id } });
  ok(Boolean(conv1b?.contactId), "talep müşteriye dönüştürülünce yazışma o müşteriye bağlandı");

  // 5) Şablon senkronu + gönderim kuralları
  await ch.syncWhatsappTemplates();
  const tpls = Object.fromEntries((await prisma.whatsappTemplate.findMany({ where: { name: { startsWith: "qa_" } } })).map((t) => [t.name, t]));
  ok(tpls.qa_randevu_onay?.paramCount === 2 && tpls.qa_gorselli?.paramCount === -1 && tpls.qa_bekleyen?.status === "PENDING", "şablonlar senkronlandı (değişken sayısı, desteklenmeyen başlık, bekleyen)");
  await rejects(ch.sendWhatsappTemplate(sales, { conversationId: conv2!.id, templateId: tpls.qa_bekleyen.id, params: [] }), /onaylanmış/, "onaysız (PENDING) şablon gönderilemez");
  await rejects(ch.sendWhatsappTemplate(sales, { conversationId: conv2!.id, templateId: tpls.qa_gorselli.id, params: [] }), /desteklemiyor/, "görsel başlıklı şablon CRM'den gönderilemez");
  await rejects(ch.sendWhatsappTemplate(sales, { conversationId: conv2!.id, templateId: tpls.qa_kampanya.id, params: [] }), /pazarlama izni/, "pazarlama şablonu izin kaydı olmadan gönderilemez");
  await rejects(ch.sendWhatsappTemplate(sales, { conversationId: conv2!.id, templateId: tpls.qa_randevu_onay.id, params: ["Ali"] }), /2 değişken/, "eksik değişken reddedilir");
  const noPerm = { ...sales, perms: effectivePermissions("READ_ONLY", []) };
  await rejects(ch.sendWhatsappTemplate(noPerm, { conversationId: conv2!.id, templateId: tpls.qa_randevu_onay.id, params: ["Ali", "Cuma"] }), /yetki/i, "salt okunur rol gönderemez");
  const sent = await ch.sendWhatsappTemplate(sales, { conversationId: conv2!.id, templateId: tpls.qa_randevu_onay.id, params: ["Ali", "14 Kasım 14:00"] });
  ok(sent.status === "QUEUED" && sent.body === "Merhaba Ali, keşif randevunuz 14 Kasım 14:00 tarihinde.", "onaylı hizmet şablonu kuyruğa alındı (metin doğru)");
  await drain();
  const afterSend = await prisma.message.findUniqueOrThrow({ where: { id: sent.id } });
  const lastCall = calls.sends.at(-1) as { to: string; type: string; template: { name: string; components: { parameters: { text: string }[] }[] } };
  ok(afterSend.status === "SENT" && afterSend.externalMessageId === "wamid.qa_out_1" && calls.sends.length === 1, "Cloud API'ye tek gönderim, durum 'Gönderildi'");
  ok(lastCall.to === "905550003003" && lastCall.type === "template" && lastCall.template.name === "qa_randevu_onay" && lastCall.template.components[0].parameters[1].text === "14 Kasım 14:00", "API isteği: şablon adı + parametreler");
  const st = (status: string, id = "wamid.qa_out_1") => ({ object: "whatsapp_business_account", entry: [{ id: "QAWABA", changes: [{ field: "messages", value: { metadata: { phone_number_id: "QAPN" }, statuses: [{ id, status, timestamp: String(Math.floor(Date.now() / 1000)), recipient_id: "905550003003" }] } }] }] });
  await post(st("delivered"));
  await post(st("sent")); // sıra dışı gelen eski durum
  await drain();
  ok((await prisma.message.findUniqueOrThrow({ where: { id: sent.id } })).status === "DELIVERED", "durum: iletildi; geç gelen 'sent' geri almadı");
  await post(st("read"));
  await drain();
  ok((await prisma.message.findUniqueOrThrow({ where: { id: sent.id } })).status === "READ", "durum: okundu");

  // Kalıcı hata (ulaştırılamaz numara) → yeniden denenmez
  const bad = await prisma.contact.create({ data: { firstName: "QA", lastName: "Ulaşılamaz", fullName: "QA Ulaşılamaz", primaryPhone: "+905550009999", ownerId: sales.id, kvkkNoticeAt: new Date() } });
  const badMsg = await ch.sendWhatsappTemplate(sales, { contactId: bad.id, templateId: tpls.qa_randevu_onay.id, params: ["Can", "Cuma"] });
  await drain();
  const badAfter = await prisma.message.findUniqueOrThrow({ where: { id: badMsg.id } });
  ok(badAfter.status === "FAILED" && /131026/.test(badAfter.error ?? "") && calls.sends.length === 2, "ulaştırılamaz numara → 'Başarısız', tekrar gönderilmedi");
  // KVKK aydınlatması yok + bize yazmamış kişi → hizmet şablonu bile gönderilmez
  const cold = await prisma.contact.create({ data: { firstName: "QA", lastName: "Soğuk", fullName: "QA Soğuk Kişi", primaryPhone: "+905550004004", ownerId: sales.id } });
  await rejects(ch.sendWhatsappTemplate(sales, { contactId: cold.id, templateId: tpls.qa_randevu_onay.id, params: ["A", "B"] }), /yazmamış/, "izin dayanağı olmayan kişiye şablon gönderilmez");
  ok(!(await prisma.conversation.findFirst({ where: { externalThreadId: "905550004004" } })), "reddedilen gönderim boş yazışma kaydı bırakmadı");

  // 6) Token süresi doldu → "Hata" + yöneticiye bildirim; gönderim engellenir
  mode.metaExpired = true;
  const hc = await ch.metaHealthCheck();
  const waConn = await prisma.integrationConnection.findUnique({ where: { provider: "WHATSAPP" } });
  const leadConn = await prisma.integrationConnection.findUnique({ where: { provider: "META_LEAD_ADS" } });
  ok(hc.WHATSAPP === "error" && waConn?.status === "ERROR" && leadConn?.status === "ERROR" && /190/.test(waConn?.lastError ?? ""), "süresi dolmuş anahtar → WhatsApp + Lead Ads 'Hata'");
  ok((await prisma.internalNotification.count({ where: { userId: manager.id, type: "integration_error" } })) === 2, "yöneticiye kanal başına bir hata bildirimi");
  await ch.metaHealthCheck();
  ok((await prisma.internalNotification.count({ where: { userId: manager.id, type: "integration_error" } })) === 2, "tekrar kontrol aynı gün yeni bildirim üretmez");
  await rejects(ch.sendWhatsappTemplate(sales, { conversationId: conv2!.id, templateId: tpls.qa_randevu_onay.id, params: ["Ali", "Cuma"] }), /hata durumunda/, "bağlantı 'Hata'yken gönderim alınmaz");
  // Hata sırasında gelen reklam formu kaybolmaz: yeniden denenir, anahtar düzelince işlenir
  const leadgen2 = { object: "page", entry: [{ id: "qa_page", changes: [{ field: "leadgen", value: { leadgen_id: "qa_lead_1b" } }] }] };
  await post(leadgen2);
  await drain();
  const ev2 = await prisma.integrationEvent.findUnique({ where: { provider_externalEventId: { provider: "META_LEAD_ADS", externalEventId: "leadgen:qa_lead_1b" } }, include: { jobs: true } });
  ok(ev2?.status === "RETRY" && ev2.jobs[0]?.status === "RETRY", "anahtar hatasında olay 'yeniden denenecek' (kaybolmadı)");
  mode.metaExpired = false;
  await ch.metaHealthCheck();
  ok((await prisma.integrationConnection.findUnique({ where: { provider: "WHATSAPP" } }))?.status === "ACTIVE", "anahtar yenilenince sağlık kontrolü 'Aktif'e döndürür");

  // 7) Google Takvim: OAuth (PKCE) + tek yönlü senkron
  const start = google.startAuthorization(manager.id);
  const u = new URL(start.url);
  const stt = google.readState(start.cookie);
  ok(u.searchParams.get("code_challenge_method") === "S256" && u.searchParams.get("code_challenge") === createHash("sha256").update(stt!.verifier).digest("base64url") && u.searchParams.get("state") === stt!.state && u.searchParams.get("access_type") === "offline", "OAuth başlangıcı: PKCE S256 + state + offline");
  ok(google.readState("bozuk.cerez.degeri") === null && google.readState(start.cookie.slice(0, -2) + "xx") === null, "kurcalanmış durum çerezi reddedilir");
  await rejects(cal.connectGoogleCalendar(sales, "qa_code", stt!.verifier), /yetki/i, "satış rolü Google bağlayamaz");
  const conn = await cal.connectGoogleCalendar(manager, "qa_code", stt!.verifier);
  const cred = await prisma.integrationCredential.findUnique({ where: { provider_key: { provider: "GOOGLE_CALENDAR", key: "refresh_token" } } });
  ok(conn.accountEmail === "qa-google@example.test" && VERIFIER_SEEN.at(-1) === stt!.verifier, "kod PKCE doğrulayıcısıyla değiştirildi; hesap e-postası okundu");
  ok(Boolean(cred) && !cred!.ciphertext.includes("qa-g-rt"), "yenileme anahtarı DB'de şifreli (düz metin yok)");

  const startAt = new Date(Date.now() + 3 * 86400_000);
  const a = await appts.createAppointment(manager, { type: "SITE_SURVEY", status: "CONFIRMED", contactId: known.id, opportunityId: null, projectId: null, startAt, endAt: new Date(startAt.getTime() + 3600_000), location: "QA Kadıköy", assignedUserId: sales.id, requestedNote: null, notes: null, allowOverlap: false });
  await drain();
  const eid = googleEventId(a.id);
  ok(calls.gInsert === 1 && gEvents.get(eid)?.summary === "Keşif (ölçü) — QA Kayıtlı Müşteri", `randevu Google'a bir kez eklendi (${String(gEvents.get(eid)?.summary)})`);
  ok(!JSON.stringify(gEvents.get(eid)).includes("+90555"), "takvim etkinliğinde müşteri telefonu yok (en az veri)");
  await appts.updateAppointment(manager, a.id, { type: "SITE_SURVEY", status: "CONFIRMED", contactId: known.id, opportunityId: null, projectId: null, startAt: new Date(startAt.getTime() + 7200_000), endAt: new Date(startAt.getTime() + 10800_000), location: "QA Üsküdar", assignedUserId: sales.id, requestedNote: null, notes: null, allowOverlap: false });
  await drain();
  ok(calls.gInsert === 1 && calls.gPatch >= 1 && gEvents.get(eid)?.location === "QA Üsküdar", "güncelleme aynı etkinliği değiştirdi (ikinci etkinlik yok)");
  await appts.setAppointmentStatus(manager, a.id, "CANCELLED");
  await drain();
  ok(!gEvents.has(eid) && calls.gDelete === 1, "iptal → Google etkinliği silindi");

  mode.googleRevoked = true;
  await appts.setAppointmentStatus(manager, a.id, "CONFIRMED");
  // Bellekteki erişim anahtarını düşür: gerçek hayatta 1 saat sonra yenileme gerekir.
  await google.revokeGoogle().catch(() => {});
  await prisma.integrationCredential.create({ data: { provider: "GOOGLE_CALENDAR", key: "refresh_token", ciphertext: cred!.ciphertext, createdById: manager.id } });
  await drain();
  const gConn = await prisma.integrationConnection.findUnique({ where: { provider: "GOOGLE_CALENDAR" } });
  ok(gConn?.status === "ERROR" && /invalid_grant/.test(gConn.lastError ?? ""), "Google erişimi iptal edildi → 'Hata'");
  ok((await prisma.internalNotification.count({ where: { userId: manager.id, type: "integration_error", title: { contains: "Google" } } })) === 1, "yöneticiye Google hata bildirimi");
  mode.googleRevoked = false;
  await cal.disconnectGoogleCalendar(manager);
  ok(!(await prisma.integrationCredential.findFirst({ where: { provider: "GOOGLE_CALENDAR" } })), "bağlantı kaldırılınca şifreli anahtar silindi");

  // 8) Gerileme: web formu aktarımı (ortak talep katmanına taşındı) aynı sonucu veriyor mu?
  const { computeSignature } = await import("@/lib/integrations/signature");
  const web = await import("@/app/api/v1/intake/website/route");
  const webPost = (p: Record<string, unknown>) => {
    const raw = JSON.stringify(p);
    const ts = String(Math.floor(Date.now() / 1000));
    const nonce = randomBytes(16).toString("hex");
    return web.POST(new NextRequest("http://localhost:3720/api/v1/intake/website", { method: "POST", body: raw, headers: { "content-type": "application/json", "x-bifire-timestamp": ts, "x-bifire-nonce": nonce, "x-bifire-signature": computeSignature(process.env.WEBSITE_HMAC_SECRET!, ts, nonce, raw) } }));
  };
  const webBase = { version: 1, formType: "QUOTE", submittedAt: new Date().toISOString(), name: "QA Web Müşteri", phone: "0555 000 50 05", email: "qa-web@example.test", message: "Ada şömine fiyatı", district: "Kadıköy", productName: "Ada", sourcePath: "/teklif-al", consent: { kvkkAcknowledged: true, consentAt: new Date().toISOString(), noticeVersion: "2026-01" } };
  ok((await webPost({ ...webBase, submissionId: "qa_web_000001" })).status === 202, "web formu imzalı kabul edildi (202)");
  ok((await webPost({ ...webBase, submissionId: "qa_web_000002", formType: "SHOWROOM", message: "Showroom ziyareti" })).status === 202, "aynı kişiden ikinci form (202)");
  await drain();
  const webLeads = await prisma.lead.findMany({ where: { sourceSubmissionId: { in: ["qa_web_000001", "qa_web_000002"] } }, orderBy: { receivedAt: "asc" }, include: { contact: { include: { consentEvents: true } } } });
  ok(webLeads.length === 2 && webLeads.every((l) => l.status === "CONVERTED") && webLeads[0].contactId === webLeads[1].contactId && webLeads[0].opportunityId === webLeads[1].opportunityId, "web: iki form → tek müşteri, ikinci talep açık fırsata eklendi");
  ok(webLeads[0].contact?.kvkkNoticeAt !== null && (webLeads[0].contact?.consentEvents.filter((e) => e.type === "KVKK_NOTICE").length ?? 0) === 2, "web: KVKK aydınlatma kanıtı her form için kaydedildi");
  ok((await prisma.task.count({ where: { contactId: webLeads[0].contactId! } })) === 2, "web: her talep için ilk dönüş görevi");

  // Kuyrukta yarım iş kalmadı mı?
  const stuck = await prisma.integrationJob.count({ where: { status: { in: ["PENDING", "PROCESSING"] }, runAt: { lte: new Date() } } });
  ok(stuck === 0, `kuyrukta bekleyen iş yok (${stuck})`);

  // Sahte sunucudan gelen "Aktif"/"Hata" durumları geliştirme DB'sinde kalmasın.
  await prisma.integrationConnection.deleteMany({ where: { provider: { in: [...CH] } } });
  console.log(fails ? `\n${fails} HATA` : "\nTümü geçti");
  process.exitCode = fails ? 1 : 0;
  await prisma.$disconnect();
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => server.close());
