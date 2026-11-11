"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { CheckSquare, Hammer, Inbox, KanbanSquare, LayoutDashboard, Menu, PlugZap, Settings, ShieldCheck, Users, X } from "lucide-react";
import { cn } from "@/components/ui/cn";
import type { NavItem } from "./nav";

const ICONS = { LayoutDashboard, Inbox, Users, KanbanSquare, Hammer, CheckSquare, PlugZap, ShieldCheck, Settings } as const;

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
    <nav aria-label="Ana menü" className="flex flex-col gap-0.5 p-3">
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
              "flex min-h-10 items-center gap-3 rounded-lg px-3 text-sm transition-colors",
              active ? "bg-accent-soft font-medium text-accent-ink" : "text-muted hover:bg-surface-2 hover:text-fg",
            )}
          >
            {Icon ? <Icon className="size-[18px] shrink-0" aria-hidden /> : null}
            <span className="flex-1 truncate">{item.label}</span>
            {badge ? <span className="rounded-full bg-danger px-1.5 text-[11px] font-semibold tabular text-white">{badge}</span> : null}
          </Link>
        );
      })}
    </nav>
  );

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="grid size-10 place-items-center rounded-lg text-muted hover:bg-surface-2 lg:hidden" aria-label="Menüyü aç">
        <Menu className="size-5" />
      </button>
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-line bg-surface lg:flex">
        <Brand />
        <div className="flex-1 overflow-y-auto">{nav}</div>
      </aside>
      {open ? (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Menü">
          <button className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} aria-label="Menüyü kapat" />
          <aside className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col bg-surface shadow-xl">
            <div className="flex items-center justify-between pr-3">
              <Brand />
              <button onClick={() => setOpen(false)} className="grid size-10 place-items-center rounded-lg text-muted hover:bg-surface-2" aria-label="Menüyü kapat">
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
    <Link href="/" className="flex h-16 items-center gap-2 px-6">
      <span className="font-display text-lg font-semibold tracking-[0.16em]">BİFİRE</span>
      <span className="rounded bg-accent-soft px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-accent-ink">CRM</span>
    </Link>
  );
}
