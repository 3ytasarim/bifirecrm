import { describe, expect, it } from "vitest";
import {
  isRateLimited,
  learnSelfIds,
  messageContent,
  normalizeIgMessage,
  safeErrorSummary,
  syncBackoffMs,
  type IgGraphMessage,
  type IgSelf,
} from "@/lib/integrations/instagram-conversations";
import { parseMetaWebhook } from "@/lib/integrations/meta-webhook";

const ACCOUNT = "17841400000000001"; // Graph hesap kimliği
const BIZ_SCOPED = "340282366841710300"; // mesajlarda görünen işletme kimliği (farklı)
const CUSTOMER = "1234567890123456";
const MID = "aWdfZAG1faXRlbToxOklHTWVzc2FnZAUlEOjE3ODQxNDAwMDAwMDAwMDAxOjM0MDI4MjM2Njg0MTcxMDMwMTI0NDI1OTg2NTYwMjI0ODcxNDAyMDozMjEzOTMzMjk0NzU3NjgxNTk4MTQ4ODc0NDA3OTQwOTk4NAZDZD";
const self: IgSelf = { ids: [ACCOUNT], username: "bifiresomine" };

const inbound: IgGraphMessage = { id: MID, created_time: "2026-11-21T10:00:00+0000", from: { id: CUSTOMER, username: "musteri" }, to: { data: [{ id: BIZ_SCOPED, username: "bifiresomine" }] }, message: "Fiyat alabilir miyim?" };
const outbound: IgGraphMessage = { id: "mid_out_1", created_time: "2026-11-21T10:05:00+0000", from: { id: BIZ_SCOPED, username: "bifiresomine" }, to: { data: [{ id: CUSTOMER, username: "musteri" }] }, message: "Tabii, hemen gönderiyorum." };

describe("Instagram Conversations API → CRM mesajı", () => {
  it("gelen mesaj: gönderen müşteri, yön INBOUND, uzun mid korunur", () => {
    const n = normalizeIgMessage(inbound, self)!;
    expect(n).toMatchObject({ mid: MID, outbound: false, customerId: CUSTOMER, customerUsername: "musteri", kind: "text", text: "Fiyat alabilir miyim?" });
    expect(n.occurredAt.toISOString()).toBe("2026-11-21T10:00:00.000Z");
  });

  it("işletme kimliği hesap kimliğinden farklı olsa da kullanıcı adıyla giden mesaj tanınır", () => {
    const n = normalizeIgMessage(outbound, self)!;
    expect(n).toMatchObject({ outbound: true, customerId: CUSTOMER });
  });

  it("işletmenin mesajlaşma kimliği öğrenilir; kullanıcı adı olmadan da yön doğru belirlenir", () => {
    const ids = learnSelfIds([inbound, outbound], self);
    expect(ids).toEqual(expect.arrayContaining([ACCOUNT, BIZ_SCOPED]));
    expect(ids).not.toContain(CUSTOMER);
    const noName: IgGraphMessage = { ...outbound, from: { id: BIZ_SCOPED }, to: { data: [{ id: CUSTOMER }] } };
    expect(normalizeIgMessage(noName, { ids, username: null })!.outbound).toBe(true);
    // Öğrenmeden önce: işletme hiçbir tarafta tanınmıyor → yanlış yönle kaydetmek yerine atlanır.
    expect(normalizeIgMessage(noName, self)).toBeNull();
  });

  it("alıcısı işletme olmayan / kimliksiz / tarihsiz mesaj atlanır", () => {
    expect(normalizeIgMessage({ ...inbound, to: { data: [{ id: "999", username: "baskasi" }] } }, self)).toBeNull();
    expect(normalizeIgMessage({ ...inbound, id: undefined }, self)).toBeNull();
    expect(normalizeIgMessage({ ...inbound, created_time: "yok" }, self)).toBeNull();
    expect(normalizeIgMessage({ ...inbound, id: "kötü id <script>" }, self)).toBeNull();
  });

  it("ekler, paylaşım ve hikâye etiketlenir", () => {
    expect(messageContent({ attachments: { data: [{ image_data: { url: "x" } }] } })).toEqual({ kind: "image", text: "[Görsel]" });
    expect(messageContent({ message: "bakın", attachments: { data: [{ video_data: {} }] } })).toEqual({ kind: "text", text: "bakın [Video]" });
    expect(messageContent({ shares: { data: [{ link: "x" }] } })).toEqual({ kind: "share", text: "[Paylaşım]" });
    expect(messageContent({ story: { mention: { link: "x" } } })).toEqual({ kind: "story_mention", text: "[Hikâye bahsi]" });
    expect(messageContent({ attachments: { data: [{ mime_type: "audio/mp4" }] } }).kind).toBe("audio");
    expect(messageContent({ is_unsupported: true })).toEqual({ kind: "unsupported", text: "[Desteklenmeyen içerik]" });
  });

  it("hız sınırı kodları ve geri çekilme", () => {
    expect(isRateLimited({ status: 400, code: 4 })).toBe(true);
    expect(isRateLimited({ status: 400, code: 613 })).toBe(true);
    expect(isRateLimited({ status: 429, code: null })).toBe(true);
    expect(isRateLimited({ status: 400, code: 100 })).toBe(false);
    expect([1, 2, 3, 10].map(syncBackoffMs)).toEqual([60_000, 120_000, 240_000, 3600_000]);
  });

  it("hata özetinde token/sorgu yer almaz", () => {
    const s = safeErrorSummary("Graph API 400: bad https://graph.facebook.com/v27.0/x?access_token=EAAB1234567890abcdefghijkl&a=1 token=abc EAAGzzzzzzzzzzzzzzzzzzzzzzzz");
    expect(s).not.toMatch(/EAAB|EAAG|abc&|access_token=EA/);
    expect(s).toContain("https://graph.facebook.com/v27.0/x");
  });
});

describe("Instagram webhook biçimleri", () => {
  it("entry.changes[field=messages] (panel test bildirimi, saniye zaman damgası) da olay üretir", () => {
    const ev = parseMetaWebhook({ object: "instagram", entry: [{ id: ACCOUNT, time: 1, changes: [{ field: "messages", value: { sender: { id: CUSTOMER }, recipient: { id: ACCOUNT }, timestamp: "1763719200", message: { mid: MID, text: "merhaba" } } }] }] });
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ provider: "INSTAGRAM_DM", externalEventId: `ig:${MID}`, jobType: "instagram.message" });
    expect(ev[0].payload).toMatchObject({ igUserId: CUSTOMER, accountId: ACCOUNT, fromBusiness: false, timestamp: 1763719200_000 });
  });

  it("entry.messaging[] biçimi değişmedi (echo = giden)", () => {
    const ev = parseMetaWebhook({ object: "instagram", entry: [{ id: ACCOUNT, messaging: [{ sender: { id: BIZ_SCOPED }, recipient: { id: CUSTOMER }, timestamp: 1763719200123, message: { mid: "m2", text: "yanıt", is_echo: true } }] }] });
    expect(ev[0].payload).toMatchObject({ igUserId: CUSTOMER, accountId: BIZ_SCOPED, fromBusiness: true, timestamp: 1763719200123 });
  });

  it("başka alan (ör. comments) mesaj olayı üretmez", () => {
    expect(parseMetaWebhook({ object: "instagram", entry: [{ id: ACCOUNT, changes: [{ field: "comments", value: { id: "c1", text: "x" } }] }] })).toEqual([]);
  });
});
