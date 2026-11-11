import Link from "next/link";
import { Bell, LogOut, Search } from "lucide-react";
import { prisma } from "@/lib/db";
import { requireActor } from "@/lib/rbac/guard";
import { taskScope } from "@/lib/rbac/scope";
import { ROLE_LABELS } from "@/lib/rbac/permissions";
import { unreadCount } from "@/lib/notifications";
import { NAV } from "@/components/shell/nav";
import { Sidebar } from "@/components/shell/sidebar";
import { ThemeToggle } from "@/components/shell/theme-toggle";
import { logout } from "../(auth)/actions";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const actor = await requireActor();
  const items = NAV.filter((i) => (!i.perm || actor.perms.has(i.perm)) && (!i.anyPerm || i.anyPerm.some((p) => actor.perms.has(p))));
  const [unread, overdue, newLeads] = await Promise.all([
    unreadCount(actor.id),
    prisma.task.count({ where: { ...taskScope(actor), assigneeId: actor.id, status: { in: ["OPEN", "IN_PROGRESS"] }, dueAt: { lt: new Date() } } }),
    actor.perms.has("leads.view") ? prisma.lead.count({ where: { status: "RECEIVED" } }) : Promise.resolve(0),
  ]);

  return (
    <div className="min-h-dvh lg:pl-64">
      <a href="#icerik" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[60] focus:rounded-lg focus:bg-surface focus:px-3 focus:py-2">
        İçeriğe geç
      </a>
      <header className="sticky top-0 z-20 flex h-16 items-center gap-2 border-b border-line bg-bg/85 px-3 backdrop-blur sm:px-6">
        <Sidebar items={items} badges={{ "/gorevler": overdue, "/talepler": newLeads }} />
        <form action="/ara" role="search" className="relative flex-1 sm:max-w-md">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
          <label htmlFor="global-search" className="sr-only">
            Müşteri, telefon, e-posta veya kayıt no ara
          </label>
          <input
            id="global-search"
            name="q"
            type="search"
            placeholder="Ara: ad, telefon, e-posta, M-/F-/P- no"
            className="h-10 w-full rounded-lg border border-line bg-surface pl-9 pr-3 text-sm placeholder:text-muted/80 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25"
          />
        </form>
        <div className="ml-auto flex items-center gap-1">
          <ThemeToggle />
          <Link href="/bildirimler" className="relative grid size-10 place-items-center rounded-lg text-muted hover:bg-surface-2 hover:text-fg" aria-label={`Bildirimler${unread ? ` (${unread} okunmamış)` : ""}`}>
            <Bell className="size-5" />
            {unread ? <span className="absolute right-1.5 top-1.5 min-w-4 rounded-full bg-danger px-1 text-center text-[10px] font-semibold leading-4 text-white tabular">{unread > 99 ? "99+" : unread}</span> : null}
          </Link>
          <details className="relative">
            <summary className="flex min-h-10 cursor-pointer list-none items-center gap-2 rounded-lg px-2 hover:bg-surface-2 [&::-webkit-details-marker]:hidden">
              <span className="grid size-8 place-items-center rounded-full bg-accent-soft text-xs font-semibold text-accent-ink" aria-hidden>
                {actor.name
                  .split(" ")
                  .map((p) => p[0])
                  .slice(0, 2)
                  .join("")
                  .toLocaleUpperCase("tr-TR")}
              </span>
              <span className="hidden text-left text-sm leading-tight md:block">
                <span className="block font-medium">{actor.name}</span>
                <span className="block text-xs text-muted">{ROLE_LABELS[actor.role]}</span>
              </span>
            </summary>
            <div className="absolute right-0 mt-2 w-56 rounded-xl border border-line bg-surface p-1.5 shadow-card">
              <Link href="/ayarlar" className="block rounded-lg px-3 py-2 text-sm hover:bg-surface-2">
                Hesap ve güvenlik
              </Link>
              <form action={logout}>
                <button className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-danger hover:bg-danger-soft">
                  <LogOut className="size-4" aria-hidden /> Çıkış yap
                </button>
              </form>
            </div>
          </details>
        </div>
      </header>
      <main id="icerik" className="mx-auto w-full max-w-[1400px] px-4 py-6 sm:px-6 lg:py-8">
        {children}
      </main>
    </div>
  );
}
