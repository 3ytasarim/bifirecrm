import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { enqueue } from "@/lib/jobs/queue";
import { markEventReceived } from "@/lib/integrations/health";
import type { ParsedMetaEvent } from "@/lib/integrations/meta-webhook";

/**
 * Webhook olaylarını integration_events'e yazar + iş kuyruğuna alır (Meta ve 360dialog uçları ortak).
 * Aynı olay ikinci kez gelirse (provider, externalEventId) tekilliği ile atlanır.
 * Bir olay kaydedilemezse `ok: false` döner → uç 500 verir, sağlayıcı bildirimi yeniden gönderir (olay kaybolmaz).
 */
export async function storeChannelEvents(events: ParsedMetaEvent[], logTag: string): Promise<{ ok: boolean; accepted: number; duplicates: number }> {
  let accepted = 0;
  let duplicates = 0;
  const providers = new Set<ParsedMetaEvent["provider"]>();
  for (const e of events) {
    try {
      await prisma.$transaction(async (t) => {
        const ev = await t.integrationEvent.create({
          data: { provider: e.provider, externalEventId: e.externalEventId, eventType: e.eventType, status: "PENDING", payload: e.payload as Prisma.InputJsonValue },
        });
        await enqueue(e.jobType, { eventId: ev.id }, { eventId: ev.id }, t);
      });
      accepted++;
      providers.add(e.provider);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        duplicates++;
        continue;
      }
      console.error(`[${logTag}] kayıt hatası:`, err instanceof Error ? err.message : "bilinmeyen");
      return { ok: false, accepted, duplicates };
    }
  }
  for (const p of providers) await markEventReceived(p).catch(() => {});
  return { ok: true, accepted, duplicates };
}
