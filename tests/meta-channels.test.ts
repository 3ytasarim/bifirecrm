import { describe, expect, it } from "vitest";
import { metaSignature, verifyMetaSignature } from "@/lib/integrations/meta-signature";
import { parseMetaWebhook, type InstagramMessagePayload, type WhatsappMessagePayload, type WhatsappStatusPayload } from "@/lib/integrations/meta-webhook";
import { googleEventId, mapLeadFields, renderTemplateBody, templateShape, validateTemplateParams } from "@/lib/integrations/channel-rules";

const SECRET = "test-app-secret-0123456789abcdef";

describe("Meta webhook imzası (X-Hub-Signature-256)", () => {
  const body = JSON.stringify({ object: "page", entry: [] });
  it("doğru imzayı kabul eder", () => {
    expect(verifyMetaSignature(SECRET, body, metaSignature(SECRET, body))).toBe(true);
  });
  it("gövde bir bayt değişirse reddeder", () => {
    expect(verifyMetaSignature(SECRET, body + " ", metaSignature(SECRET, body))).toBe(false);
  });
  it("yanlış sır, eksik/bozuk başlık reddedilir", () => {
    expect(verifyMetaSignature(SECRET, body, metaSignature("baska-sir-0123456789abcdef0000", body))).toBe(false);
    expect(verifyMetaSignature(SECRET, body, null)).toBe(false);
    expect(verifyMetaSignature(SECRET, body, "sha1=abc")).toBe(false);
    expect(verifyMetaSignature(SECRET, body, metaSignature(SECRET, body).toUpperCase())).toBe(false);
  });
});

describe("Meta webhook ayrıştırma", () => {
  it("Lead Ads: leadgen olayı tekil anahtarla", () => {
    const ev = parseMetaWebhook({ object: "page", entry: [{ id: "111", time: 1, changes: [{ field: "leadgen", value: { leadgen_id: "444", form_id: "555", ad_id: "666", page_id: "111", created_time: 1700000000 } }, { field: "feed", value: {} }] }] });
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ provider: "META_LEAD_ADS", externalEventId: "leadgen:444", jobType: "meta.leadgen", payload: { leadgenId: "444", formId: "555" } });
  });

  it("Instagram: gelen mesaj ve kendi yanıtımız (echo) doğru yönde", () => {
    const ev = parseMetaWebhook({
      object: "instagram",
      entry: [
        {
          id: "IGACC",
          messaging: [
            { sender: { id: "U1" }, recipient: { id: "IGACC" }, timestamp: 1700000000000, message: { mid: "m_1", text: "Fiyat alabilir miyim?" } },
            { sender: { id: "IGACC" }, recipient: { id: "U1" }, timestamp: 1700000001000, message: { mid: "m_2", text: "Merhaba", is_echo: true } },
            { sender: { id: "U1" }, recipient: { id: "IGACC" }, timestamp: 1700000002000, read: { mid: "m_2" } },
            { sender: { id: "U1" }, recipient: { id: "IGACC" }, timestamp: 1700000003000, message: { mid: "m_3", attachments: [{ type: "image", payload: { url: "x" } }] } },
          ],
        },
      ],
    });
    expect(ev.map((e) => e.externalEventId)).toEqual(["ig:m_1", "ig:m_2", "ig:m_3"]);
    const [inb, echo, img] = ev.map((e) => e.payload as InstagramMessagePayload);
    expect(inb).toMatchObject({ igUserId: "U1", accountId: "IGACC", fromBusiness: false, text: "Fiyat alabilir miyim?" });
    expect(echo).toMatchObject({ igUserId: "U1", fromBusiness: true });
    expect(img.text).toBe("[Görsel]");
  });

  it("WhatsApp: mesaj + durum + şablon güncellemesi; başka numaranın olayı atlanır", () => {
    const body = {
      object: "whatsapp_business_account",
      entry: [
        {
          id: "WABA",
          time: 1700000000,
          changes: [
            {
              field: "messages",
              value: {
                metadata: { phone_number_id: "PN1" },
                contacts: [{ wa_id: "905321234567", profile: { name: "Ali Veli" } }],
                messages: [
                  { from: "905321234567", id: "wamid.A", timestamp: "1700000000", type: "text", text: { body: "Merhaba" } },
                  { from: "905321234567", id: "wamid.B", timestamp: "1700000005", type: "location", location: { latitude: 41, longitude: 29, name: "Showroom" } },
                ],
                statuses: [{ id: "wamid.OUT", status: "failed", timestamp: "1700000010", recipient_id: "905321234567", errors: [{ code: 131026, title: "Message undeliverable" }] }],
              },
            },
            { field: "messages", value: { metadata: { phone_number_id: "BASKA" }, messages: [{ from: "905000000000", id: "wamid.X", timestamp: "1", type: "text", text: { body: "x" } }] } },
            { field: "message_template_status_update", value: { event: "APPROVED", message_template_id: 77, message_template_name: "randevu_onay" } },
          ],
        },
      ],
    };
    const ev = parseMetaWebhook(body, { whatsappPhoneNumberId: "PN1" });
    expect(ev.map((e) => e.externalEventId)).toEqual(["wa:wamid.A", "wa:wamid.B", "wa-status:wamid.OUT:failed", "wa-template:77:APPROVED:1700000000"]);
    const m = ev[0].payload as WhatsappMessagePayload;
    expect(m).toMatchObject({ waId: "905321234567", name: "Ali Veli", text: "Merhaba", timestamp: 1700000000000 });
    expect((ev[1].payload as WhatsappMessagePayload).text).toBe("[Konum] Showroom");
    expect((ev[2].payload as WhatsappStatusPayload).error).toBe("131026: Message undeliverable");
  });

  it("bozuk/şüpheli gövde olay üretmez", () => {
    expect(parseMetaWebhook(null)).toEqual([]);
    expect(parseMetaWebhook({ object: "page", entry: "x" })).toEqual([]);
    expect(parseMetaWebhook({ object: "page", entry: [{ changes: [{ field: "leadgen", value: { leadgen_id: "../../me?x=1 " } }] }] })).toEqual([]);
    expect(parseMetaWebhook({ object: "whatsapp_business_account", entry: [{ changes: [{ field: "messages", value: { messages: [{ from: "abc", id: "wamid.Z", type: "text" }] } }] }] })).toEqual([]);
  });

  it("aynı bildirim iki kez gelirse aynı anahtarlar üretilir (idempotency)", () => {
    const b = { object: "page", entry: [{ changes: [{ field: "leadgen", value: { leadgen_id: "9" } }] }] };
    expect(parseMetaWebhook(b)[0].externalEventId).toBe(parseMetaWebhook(JSON.parse(JSON.stringify(b)))[0].externalEventId);
  });
});

describe("Lead Ads alan eşleme", () => {
  it("standart alanlar + serbest sorular", () => {
    const r = mapLeadFields([
      { name: "full_name", values: ["Ayşe Yılmaz"] },
      { name: "phone_number", values: ["+905321112233"] },
      { name: "EMAIL", values: ["ayse@example.test"] },
      { name: "hangi_model_ile_ilgileniyorsunuz?", values: ["Ada şömine"] },
      { name: "bos", values: [] },
    ]);
    expect(r).toMatchObject({ name: "Ayşe Yılmaz", phone: "+905321112233", email: "ayse@example.test" });
    expect(r.extra).toEqual(["hangi model ile ilgileniyorsunuz?: Ada şömine"]);
  });
  it("ad/soyad ayrı gelirse birleşir", () => {
    expect(mapLeadFields([{ name: "first_name", values: ["Can"] }, { name: "last_name", values: ["Demir"] }]).name).toBe("Can Demir");
  });
});

describe("WhatsApp şablon kuralları", () => {
  it("yalnız gövde değişkenleri desteklenir", () => {
    expect(templateShape({ id: "1", name: "a", language: "tr", status: "APPROVED", category: "UTILITY", components: [{ type: "BODY", text: "Merhaba {{1}}, randevunuz {{2}}. {{1}}" }] }).paramCount).toBe(2);
    expect(templateShape({ id: "2", name: "b", language: "tr", status: "APPROVED", category: "MARKETING", components: [{ type: "HEADER", format: "IMAGE" }, { type: "BODY", text: "x" }] }).paramCount).toBe(-1);
    expect(templateShape({ id: "3", name: "c", language: "tr", status: "APPROVED", category: "UTILITY", components: [{ type: "BODY", text: "x" }, { type: "BUTTONS", buttons: [{ type: "URL", url: "https://bifire.example/{{1}}" }] }] }).paramCount).toBe(-1);
    expect(templateShape({ id: "4", name: "d", language: "tr", status: "APPROVED", category: "UTILITY", components: [{ type: "HEADER", format: "TEXT", text: "Bifire" }, { type: "BODY", text: "Merhaba" }] })).toEqual({ body: "Bifire\n\nMerhaba", paramCount: 0 });
  });
  it("parametre doğrulama ve önizleme", () => {
    expect(validateTemplateParams(["Ali", "Cuma 14:00"], 2)).toBeNull();
    expect(validateTemplateParams(["Ali"], 2)).toMatch(/2 değişken/);
    expect(validateTemplateParams(["Ali", " "], 2)).toMatch(/boş/);
    expect(validateTemplateParams(["Ali\nVeli"], 1)).toMatch(/satır sonu/);
    expect(validateTemplateParams(["a     b"], 1)).toMatch(/boşluk/);
    expect(validateTemplateParams([], -1)).toMatch(/gönderilemez/);
    expect(renderTemplateBody("Merhaba {{1}}, {{2}} {{3}}", ["Ali", "Cuma"])).toBe("Merhaba Ali, Cuma {{3}}");
  });
});

describe("Google etkinlik kimliği", () => {
  it("base32hex kuralına uyar ve randevuya özgüdür", () => {
    const id = googleEventId("0193f2a4-7c1e-7d2b-9f3a-0a1b2c3d4e5f");
    expect(id).toMatch(/^[a-v0-9]{5,1024}$/);
    expect(id).toBe("bcrm0193f2a47c1e7d2b9f3a0a1b2c3d4e5f");
  });
});
