"use client";

import { Moon, Sun } from "lucide-react";

/** Tema tercihi çerezde (sunucu ilk çizimde doğru temayı basar, titreme olmaz). */
export function ThemeToggle() {
  function toggle() {
    const root = document.documentElement;
    const current = root.dataset.theme ?? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    const next = current === "dark" ? "light" : "dark";
    root.dataset.theme = next;
    document.cookie = `bcrm_theme=${next}; path=/; max-age=31536000; samesite=lax`;
  }
  return (
    <button type="button" onClick={toggle} className="grid size-11 place-items-center rounded-full border border-line bg-surface text-muted shadow-card hover:text-fg" aria-label="Açık/koyu tema">
      <Sun className="hidden size-5 dark-icon" aria-hidden />
      <Moon className="size-5" aria-hidden />
    </button>
  );
}
