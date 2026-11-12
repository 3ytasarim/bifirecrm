import { cn } from "./cn";

/** Sunucu ve istemci bileşenlerinde ortak sınıf yardımcıları ("use client" dosyasında olmamalı). */
export function buttonClass(variant: "primary" | "secondary" | "danger" | "ghost" = "primary", size: "md" | "sm" = "md") {
  return cn(
    "inline-flex items-center justify-center gap-2 rounded-xl font-medium transition-all duration-200 disabled:cursor-not-allowed disabled:opacity-60",
    size === "md" ? "min-h-10 px-4 text-sm" : "min-h-8 px-3 text-[13px]",
    variant === "primary" && "bg-gradient-to-r from-[#a8743f] to-[#e0702e] text-white shadow-[0_8px_20px_-8px_rgb(224_112_46/0.65)] hover:brightness-110",
    variant === "secondary" && "border border-line-strong bg-surface text-fg hover:bg-surface-2",
    variant === "danger" && "bg-danger text-white hover:opacity-90",
    variant === "ghost" && "text-muted hover:bg-surface-2 hover:text-fg",
  );
}

export function inputClass(invalid = false) {
  return cn(
    "min-h-10 w-full rounded-xl border bg-surface px-3 py-2 text-sm text-fg placeholder:text-muted/70 transition-colors",
    "focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25",
    invalid ? "border-danger" : "border-line-strong",
  );
}
