import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireActor } from "@/lib/rbac/guard";
import { nowMs } from "@/lib/format";
import { appointmentScope } from "@/lib/rbac/scope";
import { APPOINTMENT_STATUS_LABELS, APPOINTMENT_STATUS_TONE, APPOINTMENT_TYPE_LABELS } from "@/lib/labels";
import { activeUsers, hrefWith } from "@/lib/queries";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui/primitives";
import { buttonClass, inputClass } from "@/components/ui/styles";

export const metadata = { title: "Takvim" };

type SP = { hafta?: string; kisi?: string; iptal?: string };

const IST = 3 * 3600_000; // Türkiye sabit UTC+3
const dayFmt = new Intl.DateTimeFormat("tr-TR", { timeZone: "Europe/Istanbul", weekday: "long", day: "numeric", month: "long" });
const timeFmt = new Intl.DateTimeFormat("tr-TR", { timeZone: "Europe/Istanbul", hour: "2-digit", minute: "2-digit" });
const rangeFmt = new Intl.DateTimeFormat("tr-TR", { timeZone: "Europe/Istanbul", day: "numeric", month: "long", year: "numeric" });

/** Verilen günün (YYYY-MM-DD, İstanbul) haftasının Pazartesi 00:00'ı (UTC Date). */
function weekStart(value: string | undefined, now: number) {
  const base = value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00Z`) : new Date(now + IST);
  base.setUTCHours(0, 0, 0, 0);
  const dow = (base.getUTCDay() + 6) % 7; // Pazartesi = 0
  return new Date(base.getTime() - dow * 86400_000 - IST);
}
const isoDay = (d: Date) => new Date(d.getTime() + IST).toISOString().slice(0, 10);

export default async function CalendarPage({ searchParams }: { searchParams: Promise<SP> }) {
  const actor = await requireActor();
  if (!actor.perms.has("calendar.view") && !actor.perms.has("calendar.view_all")) redirect("/yetkisiz");
  const sp = await searchParams;
  const now = nowMs();
  const from = weekStart(sp.hafta, now);
  const to = new Date(from.getTime() + 7 * 86400_000);
  const viewAll = actor.perms.has("calendar.view_all");
  const person = sp.kisi === "ben" ? actor.id : viewAll && sp.kisi && /^[0-9a-f-]{36}$/i.test(sp.kisi) ? sp.kisi : undefined;
  const showCancelled = sp.iptal === "1";
  const base: Prisma.AppointmentWhereInput = {
    AND: [appointmentScope(actor), person ? { assignedUserId: person } : {}, showCancelled ? {} : { status: { notIn: ["CANCELLED"] } }],
  };
  const select = { id: true, type: true, status: true, startAt: true, endAt: true, location: true, requestedNote: true, contact: { select: { fullName: true } }, assignedUserId: true } as const;
  const [rows, pending, users] = await Promise.all([
    prisma.appointment.findMany({ where: { AND: [base, { startAt: { gte: from, lt: to } }] }, orderBy: { startAt: "asc" }, select, take: 500 }),
    prisma.appointment.findMany({ where: { AND: [base, { startAt: null, status: { in: ["REQUESTED", "PROPOSED"] } }] }, orderBy: { createdAt: "asc" }, select, take: 50 }),
    activeUsers(),
  ]);
  const userName = (id: string | null) => users.find((u) => u.id === id)?.name ?? null;
  const days = Array.from({ length: 7 }, (_, i) => new Date(from.getTime() + i * 86400_000));
  const todayKey = isoDay(new Date(now));
  const path = "/takvim";
  const canManage = actor.perms.has("calendar.manage");

  return (
    <>
      <PageHeader
        title="Takvim"
        description="Showroom ziyaretleri, keşif (ölçü), montaj ve görüşmeler."
        actions={
          canManage ? (
            <Link href="/takvim/yeni" className={buttonClass()}>
              + Randevu
            </Link>
          ) : null
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-line bg-surface p-3 shadow-card">
        <Link href={hrefWith(path, sp, { hafta: isoDay(new Date(from.getTime() - 7 * 86400_000)) })} className={buttonClass("secondary", "sm")} aria-label="Önceki hafta">
          <ChevronLeft className="size-4" aria-hidden />
        </Link>
        <Link href={hrefWith(path, sp, { hafta: undefined })} className={buttonClass("secondary", "sm")}>
          Bu hafta
        </Link>
        <Link href={hrefWith(path, sp, { hafta: isoDay(new Date(from.getTime() + 7 * 86400_000)) })} className={buttonClass("secondary", "sm")} aria-label="Sonraki hafta">
          <ChevronRight className="size-4" aria-hidden />
        </Link>
        <h2 className="ml-1 text-sm font-semibold">
          {rangeFmt.format(from)} – {rangeFmt.format(new Date(to.getTime() - 1))}
        </h2>
        <form className="ml-auto flex flex-wrap items-center gap-2">
          {sp.hafta ? <input type="hidden" name="hafta" value={sp.hafta} /> : null}
          <select name="kisi" defaultValue={sp.kisi ?? ""} className={inputClass()} aria-label="Kişi">
            <option value="">{viewAll ? "Herkes" : "Erişebildiklerim"}</option>
            <option value="ben">Yalnız bana atananlar</option>
            {viewAll
              ? users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))
              : null}
          </select>
          <label className="flex items-center gap-1.5 text-xs text-muted">
            <input type="checkbox" name="iptal" value="1" defaultChecked={showCancelled} className="accent-[var(--accent)]" /> İptaller
          </label>
          <button className={buttonClass("secondary", "sm")}>Uygula</button>
        </form>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1fr_300px]">
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-7">
          {days.map((d) => {
            const key = isoDay(d);
            const items = rows.filter((r) => r.startAt && isoDay(r.startAt) === key);
            return (
              <section key={key} aria-label={dayFmt.format(d)} className={`min-h-28 rounded-xl border bg-surface p-2.5 shadow-card ${key === todayKey ? "border-accent" : "border-line"}`}>
                <h3 className={`mb-2 text-xs font-semibold capitalize ${key === todayKey ? "text-accent-ink" : "text-muted"}`}>{dayFmt.format(d)}</h3>
                {items.length ? (
                  <ul className="space-y-2">
                    {items.map((a) => (
                      <li key={a.id}>
                        <Link href={`/takvim/${a.id}`} className={`block rounded-lg border border-line p-2 text-xs hover:border-accent ${a.status === "CANCELLED" ? "opacity-60 line-through" : ""}`}>
                          <span className="font-semibold tabular">
                            {timeFmt.format(a.startAt!)}
                            {a.endAt ? `–${timeFmt.format(a.endAt)}` : ""}
                          </span>
                          <span className="mt-0.5 block font-medium text-fg">{a.contact.fullName}</span>
                          <span className="block text-muted">{APPOINTMENT_TYPE_LABELS[a.type]}</span>
                          {userName(a.assignedUserId) ? <span className="block text-muted">{userName(a.assignedUserId)}</span> : null}
                          <Badge tone={APPOINTMENT_STATUS_TONE[a.status]} className="mt-1">
                            {APPOINTMENT_STATUS_LABELS[a.status]}
                          </Badge>
                        </Link>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-xs text-muted/70">—</p>
                )}
              </section>
            );
          })}
        </div>
        <Card title={`Zamanı bekleyenler (${pending.length})`} padded={false}>
          {pending.length ? (
            <ul className="divide-y divide-line">
              {pending.map((a) => (
                <li key={a.id}>
                  <Link href={`/takvim/${a.id}`} className="block px-5 py-3 text-sm hover:bg-surface-2/50">
                    <span className="font-medium">{a.contact.fullName}</span>
                    <span className="block text-xs text-muted">
                      {APPOINTMENT_TYPE_LABELS[a.type]}
                      {a.requestedNote ? ` · ${a.requestedNote}` : ""}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="Bekleyen talep yok" description="Saati belli olmayan randevu talepleri burada görünür." />
          )}
        </Card>
      </div>
      {rows.length === 0 ? <p className="mt-4 text-sm text-muted">Bu hafta planlı randevu yok.</p> : null}
    </>
  );
}
