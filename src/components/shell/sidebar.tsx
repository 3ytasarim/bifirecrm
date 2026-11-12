"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { BarChart3, CalendarDays, Flame, CheckSquare, FileText, Hammer, Inbox, KanbanSquare, LayoutDashboard, Menu, MessageCircle, MessageSquareText, PlugZap, Settings, ShieldCheck, Users, X } from "lucide-react";
import { cn } from "@/components/ui/cn";
import type { NavItem } from "./nav";

const ICONS = { LayoutDashboard, Inbox, Users, KanbanSquare, FileText, CalendarDays, Hammer, CheckSquare, BarChart3, MessageCircle, MessageSquareText, PlugZap, ShieldCheck, Settings } as const;

export function Sidebar({ items, badges }: { items: NavItem[]; badges: Record<string, number> }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  // Sayfa değişince mobil menüyü kapat (effect yerine render sırasında önceki yolu karşılaştır).
  const [lastPath, setLastPath] = useState(pathname);
  if (lastPath !== pathname) {
    setLastPath(pathname);
    setOpen(false);
  }

  const nav = (
    <nav aria-label="Ana menü" className="flex flex-col gap-1 px-3 pb-3">
      {items.map((item) => {
        const Icon = ICONS[item.icon as keyof typeof ICONS];
        const active = item.href === "/" ? pathname === "/" : pathname === item.href || pathname.startsWith(item.href + "/");
        const badge = badges[item.href];
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "group flex min-h-11 items-center gap-3 rounded-2xl px-3 text-sm transition-all duration-200",
              active
                ? "bg-gradient-to-r from-[#b07a47] to-[#e0702e] font-semibold text-white shadow-[0_8px_20px_-6px_rgb(224_112_46/0.6)]"
                : "text-white/70 hover:bg-white/10 hover:text-white",
            )}
          >
            {Icon ? <Icon className={cn("size-[18px] shrink-0 transition-transform duration-200", !active && "group-hover:scale-110")} aria-hidden /> : null}
            <span className="flex-1 truncate">{item.label}</span>
            {badge ? <span className={cn("rounded-full px-1.5 text-[11px] font-semibold tabular", active ? "bg-white/25 text-white" : "bg-[#e0702e] text-white")}>{badge}</span> : null}
          </Link>
        );
      })}
    </nav>
  );

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="grid size-11 place-items-center rounded-full border border-line bg-surface text-muted shadow-card lg:hidden" aria-label="Menüyü aç">
        <Menu className="size-5" />
      </button>
      <aside className="glass-rail fixed bottom-4 left-4 top-4 z-30 hidden w-[15.5rem] flex-col rounded-[30px] lg:flex">
        <Brand />
        <div className="flex-1 overflow-y-auto">{nav}</div>
      </aside>
      {open ? (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Menü">
          <button className="absolute inset-0 bg-black/45" onClick={() => setOpen(false)} aria-label="Menüyü kapat" />
          <aside className="glass-rail absolute bottom-2 left-2 top-2 flex w-72 max-w-[85vw] flex-col rounded-[28px]">
            <div className="flex items-center justify-between pr-3">
              <Brand />
              <button onClick={() => setOpen(false)} className="grid size-10 place-items-center rounded-full text-white/70 hover:bg-white/10 hover:text-white" aria-label="Menüyü kapat">
                <X className="size-5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto">{nav}</div>
          </aside>
        </div>
      ) : null}
    </>
  );
}

function Brand() {
  return (
    <Link href="/" className="flex h-20 items-center gap-3 px-5">
      <span className="grid size-10 place-items-center rounded-2xl bg-gradient-to-br from-[#c08a55] to-[#e0702e] shadow-[0_8px_20px_-6px_rgb(224_112_46/0.7)]" aria-hidden>
        <Flame className="size-5 text-white" />
      </span>
      <span className="leading-tight">
        <span className="block font-display text-[17px] font-bold tracking-[0.18em] text-white">BİFİRE</span>
        <span className="block text-[10px] font-medium uppercase tracking-[0.24em] text-white/55">CRM</span>
      </span>
    </Link>
  );
}
