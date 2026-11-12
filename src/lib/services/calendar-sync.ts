import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { audit } from "@/lib/audit";
import { RuleError } from "@/lib/errors";
import { assertCan, type Actor } from "@/lib/rbac/assert";
import { enqueue } from "@/lib/jobs/queue";
import { APPOINTMENT_STATUS_LABELS, APPOINTMENT_TYPE_LABELS } from "@/lib/labels";
import { calendarRequest, completeAuthorization, GoogleApiError, hasGoogleCredential, revokeGoogle } from "@/lib/integrations/google";
import { handleProviderError, markConnectionOk } from "@/lib/integrations/health";
import { googleEventId } from "@/lib/integrations/channel-rules";

type Tx = Prisma.TransactionClient | typeof prisma;

/**
 * CRM randevusu → Google Takvim etkinliği (tek yönlü). Etkinlik kimliği randevu kimliğinden türetilir
 * ("bcrm" + uuid onaltılık; Google'ın base32hex kuralına uyar) → aynı randevu için ikinci etkinlik oluşmaz,
 * yeniden deneme güvenlidir. Müşteri telefonu/e-postası takvime yazılmaz (KVKK: en az veri); CRM bağlantısı eklenir.
 * Katılımcı eklenmez → Google kimseye davet e-postası göndermez.
 */

async function calendarId() {
  const c = await prisma.integrationConnection.findUnique({ where: { provider: "GOOGLE_CALENDAR" }, select: { config: true } });
  const id = (c?.config as { calendarId?: string } | null)?.calendarId;
  return id && /^[A-Za-z0-9@._-]{1,200}$/.test(id) ? id : "primary";
}

/** Randevu değişince çağrılır (aynı işlem içinde). Google bağlı değilse hiçbir şey yapmaz. */
export async function enqueueCalendarSync(t: Tx, appointmentId: string) {
  const cred = await t.integrationCredential.findUnique({ where: { provider_key: { provider: "GOOGLE_CALENDAR", key: "refresh_token" } }, select: { id: true } });
  if (!cred) return;
  await enqueue("gcal.sync_appointment", { appointmentId }, { maxAttempts: 6 }, t);
}

export async function syncAppointmentToGoogle(appointmentId: string) {
  const a = await prisma.appointment.findUnique({ where: { id: appointmentId }, include: { contact: { select: { fullName: true } }, opportunity: { select: { title: true } }, project: { select: { name: true } } } });
  const cal = encodeURIComponent(await calendarId());
  const eid = googleEventId(appointmentId);
  try {
    if (!a || !a.startAt || a.status === "CANCELLED") {
      try {
        await calendarRequest(`calendars/${cal}/events/${eid}`, { method: "DELETE", query: { sendUpdates: "none" } });
      } catch (e) {
        if (!(e instanceof GoogleApiError && (e.status === 404 || e.status === 410))) throw e;
      }
      await markConnectionOk("GOOGLE_CALENDAR");
      return { action: "deleted" as const };
    }
    const end = a.endAt ?? new Date(a.startAt.getTime() + 3600_000);
    const event = {
      summary: `${APPOINTMENT_TYPE_LABELS[a.type]} — ${a.contact.fullName}`.slice(0, 250),
      description: [`Durum: ${APPOINTMENT_STATUS_LABELS[a.status]}`, a.opportunity ? `Fırsat: ${a.opportunity.title}` : null, a.project ? `Proje: ${a.project.name}` : null, `${env().APP_URL.replace(/\/$/, "")}/takvim/${a.id}`].filter(Boolean).join("\n"),
      location: a.location ?? undefined,
      start: { dateTime: a.startAt.toISOString(), timeZone: "Europe/Istanbul" },
      end: { dateTime: end.toISOString(), timeZone: "Europe/Istanbul" },
      status: a.status === "REQUESTED" || a.status === "PROPOSED" ? "tentative" : "confirmed",
      extendedProperties: { private: { bcrmAppointmentId: a.id } },
    };
    let action: "updated" | "created" = "updated";
    try {
      await calendarRequest(`calendars/${cal}/events/${eid}`, { method: "PATCH", body: event, query: { sendUpdates: "none" } });
    } catch (e) {
      if (!(e instanceof GoogleApiError && e.status === 404)) throw e;
      await calendarRequest(`calendars/${cal}/events`, { method: "POST", body: { id: eid, ...event }, query: { sendUpdates: "none" } });
      action = "created";
    }
    await markConnectionOk("GOOGLE_CALENDAR");
    return { action };
  } catch (e) {
    return handleProviderError("GOOGLE_CALENDAR", e);
  }
}

/** OAuth callback'ten: bağlantıyı kaydeder ve mevcut ileri tarihli randevuları senkron kuyruğuna alır. */
export async function connectGoogleCalendar(actor: Actor, code: string, verifier: string) {
  assertCan(actor, "integrations.manage");
  const { accountEmail } = await completeAuthorization(code, verifier, actor.id);
  await markConnectionOk("GOOGLE_CALENDAR", { accountEmail, calendarId: "primary" });
  await prisma.integrationConnection.update({ where: { provider: "GOOGLE_CALENDAR" }, data: { lastError: null, lastErrorAt: null } });
  const upcoming = await prisma.appointment.findMany({ where: { startAt: { gte: new Date(Date.now() - 86400_000) }, status: { not: "CANCELLED" } }, select: { id: true }, take: 500 });
  for (const u of upcoming) await enqueue("gcal.sync_appointment", { appointmentId: u.id }, { maxAttempts: 6 });
  await audit({ actorId: actor.id, action: "google_calendar_connect", entityType: "integration", entityId: "GOOGLE_CALENDAR", summary: accountEmail ?? undefined, after: { queued: upcoming.length } });
  return { accountEmail, queued: upcoming.length };
}

export async function disconnectGoogleCalendar(actor: Actor) {
  assertCan(actor, "integrations.manage");
  if (!(await hasGoogleCredential())) throw new RuleError("Google Takvim zaten bağlı değil.");
  await revokeGoogle();
  await prisma.integrationConnection.update({ where: { provider: "GOOGLE_CALENDAR" }, data: { status: "NOT_CONFIGURED", config: { calendarId: "primary" } } });
  await audit({ actorId: actor.id, action: "google_calendar_disconnect", entityType: "integration", entityId: "GOOGLE_CALENDAR" });
}

/** Worker sağlık kontrolü: bağlıysa takvimden tek etkinlik okumayı dener (calendar.events kapsamı yeterli) (yenileme anahtarı iptal edildiyse "Hata" + bildirim). */
export async function googleHealthCheck() {
  if (!(await hasGoogleCredential())) return null;
  try {
    await calendarRequest(`calendars/${encodeURIComponent(await calendarId())}/events`, { method: "GET", query: { maxResults: "1" } });
    await markConnectionOk("GOOGLE_CALENDAR");
    return "ok";
  } catch (e) {
    await handleProviderError("GOOGLE_CALENDAR", e).catch(() => {});
    return "error";
  }
}
