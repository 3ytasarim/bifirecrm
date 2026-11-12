import { CalendarDays, Flame, MessageCircle, ShieldCheck } from "lucide-react";

/**
 * Giriş / şifre ekranları: iç mekân fotoğrafı üzerinde iki bölmeli koyu cam kart.
 * Kart her temada koyu (.force-dark), sol bölme form, sağ bölme karşılama paneli (mobilde gizli).
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="relative grid min-h-dvh place-items-center px-4 py-10">
      <div aria-hidden className="pointer-events-none fixed inset-0 -z-[1] bg-gradient-to-br from-black/45 via-black/30 to-[#3a1e0c]/50" />

      <div className="force-dark glass-rail animate-rise grid w-full max-w-[900px] overflow-hidden rounded-[32px] text-fg md:grid-cols-[1.05fr_1fr]">
        <div className="p-7 sm:p-10">
          <div className="mb-8 flex items-center gap-3">
            <span className="grid size-10 place-items-center rounded-2xl bg-gradient-to-br from-[#c08a55] to-[#e0702e] shadow-[0_8px_20px_-6px_rgb(224_112_46/0.7)]" aria-hidden>
              <Flame className="size-5 text-white" />
            </span>
            <span className="leading-tight">
              <span className="block font-display text-[17px] font-bold tracking-[0.18em]">BİFİRE</span>
              <span className="block text-[10px] font-medium uppercase tracking-[0.24em] text-muted">Müşteri & Proje Yönetimi</span>
            </span>
          </div>
          {children}
        </div>

        <aside className="relative hidden flex-col justify-center overflow-hidden border-l border-white/10 p-10 md:flex">
          <div aria-hidden className="absolute inset-0 bg-[radial-gradient(circle_at_80%_15%,rgb(224_112_46/0.35),transparent_55%),radial-gradient(circle_at_10%_95%,rgb(192_138_85/0.28),transparent_50%)]" />
          <div className="relative">
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-accent-ink">Bifire Şömine</p>
            <h2 className="mt-3 font-display text-4xl font-extrabold leading-[1.05] tracking-tight text-white">
              Hoş
              <br />
              geldiniz!
            </h2>
            <p className="mt-4 max-w-xs text-sm leading-relaxed text-white/75">Talepler, teklifler, randevular ve projeler tek ekranda. Ekip hesabınızla devam edin.</p>
            <ul className="mt-8 space-y-3 text-sm text-white/85">
              <li className="flex items-center gap-3">
                <span className="grid size-8 place-items-center rounded-full bg-white/10 ring-1 ring-white/15" aria-hidden>
                  <MessageCircle className="size-4" />
                </span>
                Web, Meta ve WhatsApp talepleri
              </li>
              <li className="flex items-center gap-3">
                <span className="grid size-8 place-items-center rounded-full bg-white/10 ring-1 ring-white/15" aria-hidden>
                  <CalendarDays className="size-4" />
                </span>
                Keşif, showroom ve montaj takvimi
              </li>
              <li className="flex items-center gap-3">
                <span className="grid size-8 place-items-center rounded-full bg-white/10 ring-1 ring-white/15" aria-hidden>
                  <ShieldCheck className="size-4" />
                </span>
                Hesaplar yalnız yönetici davetiyle açılır
              </li>
            </ul>
          </div>
        </aside>
      </div>
    </main>
  );
}
