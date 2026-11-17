import { describe, expect, it } from "vitest";
import { parseD360Event, parseMetaWebhook, type WhatsappHistoryPayload, type WhatsappMessagePayload } from "@/lib/integrations/meta-webhook";

const meta = { display_phone_number: "905550000000", phone_number_id: "PN1" };
const envelope = (field: string, value: Record<string, unknown>) => ({ object: "whatsapp_business_account", entry: [{ id: "WABA", changes: [{ field, value: { messaging_product: "whatsapp", metadata: meta, ...value } }] }] });

describe("WhatsApp coexistence: telefondan yazılan yanıtlar (smb_message_echoes)", () => {
  it("echo giden mesaj olur, karşı taraf 'to'dur", () => {
    const ev = parseMetaWebhook(envelope("smb_message_echoes", { message_echoes: [{ from: "905550000000", to: "905321112233", id: "wamid.E1", timestamp: "1700000000", type: "text", text: { body: "Merhaba" } }] }));
    expect(ev).toHaveLength(1);
    const p = ev[0].payload as WhatsappMessagePayload;
    expect(ev[0]).toMatchObject({ provider: "WHATSAPP", externalEventId: "wa:wamid.E1", eventType: "echo.text", jobType: "whatsapp.message" });
    expect(p).toMatchObject({ waId: "905321112233", outbound: true, historical: false, text: "Merhaba", timestamp: 1700000000000 });
  });

  it("gelen mesajla aynı tekil anahtarı kullanır (aynı wamid iki kez kayıt açmaz)", () => {
    const echo = parseMetaWebhook(envelope("smb_message_echoes", { message_echoes: [{ from: "905550000000", to: "905321112233", id: "wamid.X", timestamp: "1", type: "text", text: { body: "a" } }] }));
    const hist = parseD360Event({ id: "h1", event: "history", data: { metadata: meta, history: [{ threads: [{ id: "905321112233", messages: [{ from: "905550000000", to: "905321112233", id: "wamid.X", timestamp: "1", type: "text", text: { body: "a" } }] }] }] } });
    expect(echo[0].externalEventId).toBe("wa:wamid.X");
    expect((hist.events[0].payload as WhatsappHistoryPayload).messages[0].id).toBe("wamid.X");
  });

  it("başka numaranın echo'su elenir; geçersiz alıcı atlanır", () => {
    const other = { ...envelope("smb_message_echoes", { message_echoes: [{ to: "905321112233", id: "wamid.O", timestamp: "1", type: "text", text: { body: "x" } }] }) };
    (other.entry[0].changes[0].value as { metadata: unknown }).metadata = { phone_number_id: "BASKA" };
    expect(parseMetaWebhook(other, { whatsappPhoneNumberId: "PN1" })).toHaveLength(0);
    expect(parseMetaWebhook(envelope("smb_message_echoes", { message_echoes: [{ to: "abc", id: "wamid.Y", type: "text" }] }))).toHaveLength(0);
  });
});

describe("WhatsApp coexistence: 360dialog olayları", () => {
  it("history: tek olay, mesajlar yön ve 'geçmiş' işaretiyle", () => {
    const r = parseD360Event({
      id: "EVT1",
      event: "history",
      data: {
        metadata: meta,
        history: [{ metadata: { phase: 0 }, threads: [{ id: "905321112233", messages: [
          { from: "905321112233", id: "wamid.H1", timestamp: "1700000000", type: "text", text: { body: "Fiyat?" } },
          { from: "905550000000", to: "905321112233", id: "wamid.H2", timestamp: "1700000060", type: "image", image: { caption: "Katalog" } },
        ] }] }],
      },
    });
    expect(r.kind).toBe("history");
    expect(r.events).toHaveLength(1);
    expect(r.events[0]).toMatchObject({ provider: "WHATSAPP", externalEventId: "wa-history:EVT1", jobType: "whatsapp.history" });
    const msgs = (r.events[0].payload as WhatsappHistoryPayload).messages;
    expect(msgs.map((m) => [m.id, m.outbound, m.historical, m.waId])).toEqual([
      ["wamid.H1", false, true, "905321112233"],
      ["wamid.H2", true, true, "905321112233"],
    ]);
    expect(msgs[1].text).toBe("[Görsel] Katalog");
  });

  it("history: paylaşım reddedildiyse olay yok, 'declined' işaretli", () => {
    const r = parseD360Event({ id: "E", event: "history", data: { metadata: meta, history: [{ errors: [{ code: 2593109 }] }] } });
    expect(r).toMatchObject({ kind: "history", declined: true, events: [] });
  });

  it("rehber eşitlemesi CRM'e kayıt açmaz; Meta zarfı 'other' döner", () => {
    expect(parseD360Event({ id: "DM3", event: "smb_app_state_sync", data: { state_sync: [{ type: "contact" }] } })).toMatchObject({ kind: "state_sync", events: [] });
    expect(parseD360Event(envelope("messages", {})).kind).toBe("other");
    expect(parseD360Event(null).kind).toBe("other");
  });
});
