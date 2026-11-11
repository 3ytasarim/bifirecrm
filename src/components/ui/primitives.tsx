import Link from "next/link";
import type { ReactNode } from "react";
import { ChevronLeft, ChevronRight, Inbox } from "lucide-react";
import { cn } from "./cn";

export function PageHeader({ title, description, actions, back }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; back?: { href: string; label: string } }) {
  return (
    <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {back ? (
          <Link href={back.href} className="mb-2 inline-flex items-center gap-1 text-[13px] text-muted hover:text-fg">
            <ChevronLeft className="size-4" aria-hidden />
            {back.label}
          </Link>
        ) : null}
        <h1 className="font-display text-2xl font-semibold tracking-tight text-fg sm:text-[28px]">{title}</h1>
        {description ? <p className="mt-1 text-sm text-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}

export function Card({ children, className, title, actions, padded = true }: { children: ReactNode; className?: string; title?: ReactNode; actions?: ReactNode; padded?: boolean }) {
  return (
    <section className={cn("rounded-xl border border-line bg-surface shadow-card", className)}>
      {title || actions ? (
        <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3.5">
          {title ? <h2 className="font-display text-[15px] font-semibold">{title}</h2> : <span />}
          {actions}
        </div>
      ) : null}
      <div className={padded ? "p-5" : undefined}>{children}</div>
    </section>
  );
}

const TONES = {
  neutral: "bg-surface-2 text-muted border-line",
  accent: "bg-accent-soft text-accent-ink border-accent/20",
  success: "bg-success-soft text-success border-success/20",
  danger: "bg-danger-soft text-danger border-danger/20",
  warning: "bg-warning-soft text-warning border-warning/20",
  info: "bg-info-soft text-info border-info/20",
} as const;
export type Tone = keyof typeof TONES;

export function Badge({ children, tone = "neutral", className }: { children: ReactNode; tone?: Tone; className?: string }) {
  return <span className={cn("inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium", TONES[tone], className)}>{children}</span>;
}

export function EmptyState({ title, description, action, icon }: { title: string; description?: string; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      <div className="mb-3 grid size-11 place-items-center rounded-full bg-surface-2 text-muted">{icon ?? <Inbox className="size-5" aria-hidden />}</div>
      <p className="font-medium">{title}</p>
      {description ? <p className="mt-1 max-w-sm text-sm text-muted">{description}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function Pagination({ page, pageCount, buildHref, total }: { page: number; pageCount: number; total: number; buildHref: (p: number) => string }) {
  if (pageCount <= 1) return <p className="px-5 py-3 text-xs text-muted">{total} kayıt</p>;
  return (
    <nav aria-label="Sayfalama" className="flex items-center justify-between gap-3 border-t border-line px-5 py-3 text-sm">
      <span className="text-xs text-muted">
        {total} kayıt · Sayfa {page}/{pageCount}
      </span>
      <div className="flex gap-1">
        {page > 1 ? (
          <Link className="grid size-9 place-items-center rounded-lg border border-line hover:bg-surface-2" href={buildHref(page - 1)} aria-label="Önceki sayfa">
            <ChevronLeft className="size-4" />
          </Link>
        ) : null}
        {page < pageCount ? (
          <Link className="grid size-9 place-items-center rounded-lg border border-line hover:bg-surface-2" href={buildHref(page + 1)} aria-label="Sonraki sayfa">
            <ChevronRight className="size-4" />
          </Link>
        ) : null}
      </div>
    </nav>
  );
}

export function Stat({ label, value, hint, href, tone }: { label: string; value: ReactNode; hint?: ReactNode; href?: string; tone?: "danger" | "accent" }) {
  const inner = (
    <>
      <p className="text-[13px] text-muted">{label}</p>
      <p className={cn("mt-1 font-display text-[28px] font-semibold tabular leading-tight", tone === "danger" && "text-danger", tone === "accent" && "text-accent-ink")}>{value}</p>
      {hint ? <p className="mt-0.5 text-xs text-muted">{hint}</p> : null}
    </>
  );
  const cls = "block rounded-xl border border-line bg-surface p-4 shadow-card";
  return href ? (
    <Link href={href} className={cn(cls, "transition-colors hover:border-line-strong")}>
      {inner}
    </Link>
  ) : (
    <div className={cls}>{inner}</div>
  );
}

export function Tabs({ tabs, active }: { tabs: { key: string; label: string; href: string; count?: number }[]; active: string }) {
  return (
    <nav aria-label="Sekmeler" className="-mx-1 mb-5 flex gap-1 overflow-x-auto border-b border-line px-1">
      {tabs.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          scroll={false}
          aria-current={t.key === active ? "page" : undefined}
          className={cn(
            "-mb-px inline-flex min-h-11 items-center gap-1.5 whitespace-nowrap border-b-2 px-3 text-sm transition-colors",
            t.key === active ? "border-accent font-medium text-fg" : "border-transparent text-muted hover:text-fg",
          )}
        >
          {t.label}
          {t.count !== undefined ? <span className="rounded-full bg-surface-2 px-1.5 text-[11px] tabular text-muted">{t.count}</span> : null}
        </Link>
      ))}
    </nav>
  );
}

export function DefList({ items }: { items: { label: string; value: ReactNode }[] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
      {items.map((i) => (
        <div key={i.label} className="min-w-0">
          <dt className="text-xs text-muted">{i.label}</dt>
          <dd className="mt-0.5 break-words">{i.value || <span className="text-muted">—</span>}</dd>
        </div>
      ))}
    </dl>
  );
}

export const tableCls = {
  wrap: "overflow-x-auto",
  table: "w-full min-w-[640px] text-left text-sm",
  th: "border-b border-line bg-surface-2/60 px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-muted",
  td: "border-b border-line px-4 py-3 align-top",
  row: "transition-colors hover:bg-surface-2/50",
};
