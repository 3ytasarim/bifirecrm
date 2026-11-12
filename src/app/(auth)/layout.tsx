import { ArrowUpRight, CalendarDays, Flame, MessageCircle, ShieldCheck } from "lucide-react";

/**
 * Giriş / şifre ekranları: tam ekran Bifire şömine fotoğrafı, solda karşılama, sağda buzlu cam form kartı.
 * Her temada koyu (.force-dark); mobilde karşılama kısalır, kart tam genişlik olur.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="force-dark relative flex min-h-dvh flex-col overflow-hidden text-fg">
      {/* Fotoğraf + okunurluk için sol tarafı koyulaştıran katman */}
      <div aria-hidden className="pointer-events-none fixed inset-0 -z-[1] bg-[#0d0b09] bg-[url('/bg/login.webp')] bg-cover bg-[position:62%_center]" />
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 -z-[1] bg-[linear-gradient(90deg,rgb(10_8_6/0.82)_0%,rgb(10_8_6/0.5)_45%,rgb(10_8_6/0.25)_100%),radial-gradient(circle_at_75%_60%,rgb(224_112_46/0.18),transparent_45%)] max-lg:bg-[linear-gradient(180deg,rgb(10_8_6/0.7),rgb(10_8_6/0.55)_50%,rgb(10_8_6/0.8))]"
      />
      {/* Dekoratif ince halkalar */}
      <div aria-hidden className="pointer-events-none fixed -left-20 -top-24 -z-[1] size-64 rounded-full border-[3px] border-white/12" />
      <div aria-hidden className="pointer-events-none fixed -bottom-16 left-[18%] -z-[1] size-48 rounded-full border-[3px] border-white/10 max-lg:hidden" />
      <div aria-hidden className="pointer-events-none fixed bottom-8 right-6 -z-[1] size-40 rounded-full border-[3px] border-[#e0702e]/25 max-lg:hidden" />

      <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-5 pt-6 sm:px-8 sm:pt-8">
        <div className="flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-2xl bg-gradient-to-br from-[#c08a55] to-[#e0702e] shadow-[0_8px_20px_-6px_rgb(224_112_46/0.7)]" aria-hidden>
            <Flame className="size-5 text-white" />
          </span>
          <span className="leading-tight text-white">
            <span className="block font-display text-[17px] font-bold tracking-[0.18em]">BİFİRE</span>
            <span className="block text-[10px] font-medium uppercase tracking-[0.24em] text-white/60 max-sm:hidden">Müşteri & Proje Yönetimi</span>
          </span>
        </div>
        <a
          href="https://www.bifiresomine.com"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-10 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-white/20 bg-white/10 px-4 text-[13px] font-semibold text-white backdrop-blur-md transition hover:bg-white/20"
        >
          Siteye git
          <ArrowUpRight className="size-4" aria-hidden />
        </a>
      </header>

      <div className="mx-auto grid w-full max-w-6xl flex-1 items-center gap-10 px-5 py-10 sm:px-8 lg:grid-cols-[1fr_440px] lg:gap-16">
        <section className="animate-rise text-white max-lg:text-center">
          <p className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-black/30 px-3.5 py-1.5 text-[12px] font-semibold tracking-wide text-white/85 backdrop-blur-md">
            <span className="size-1.5 rounded-full bg-[#f08a4b] shadow-[0_0_10px_#f08a4b]" aria-hidden />
            Bifire Şömine · Ekip paneli
          </p>
          <p className="mt-5 font-display text-5xl font-extrabold leading-[1.02] tracking-[-0.03em] [text-shadow:0_4px_24px_rgb(0_0_0/0.45)] sm:text-6xl xl:text-7xl">Hoş geldiniz</p>
          <p className="mt-4 max-w-md text-base leading-relaxed text-white/80 max-lg:mx-auto max-lg:hidden">
            Talepler, teklifler, randevular ve projeler tek ekranda. Ekip hesabınızla giriş yapın.
          </p>
          <ul className="mt-8 flex flex-wrap gap-2.5 max-lg:hidden">
            {[
              { icon: MessageCircle, text: "Web, Meta ve WhatsApp talepleri" },
              { icon: CalendarDays, text: "Keşif ve montaj takvimi" },
              { icon: ShieldCheck, text: "Yalnız davetle hesap" },
            ].map(({ icon: Icon, text }) => (
              <li key={text} className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-black/30 py-1.5 pl-1.5 pr-3.5 text-[13px] font-medium text-white/90 backdrop-blur-md">
                <span className="grid size-7 place-items-center rounded-full bg-white/12" aria-hidden>
                  <Icon className="size-3.5" />
                </span>
                {text}
              </li>
            ))}
          </ul>
        </section>

        <div className="auth-glass animate-rise w-full p-7 [animation-delay:120ms] max-lg:mx-auto max-lg:max-w-[440px] sm:p-9">{children}</div>
      </div>

      <footer className="mx-auto w-full max-w-6xl px-5 pb-6 text-center text-xs text-white/55 sm:px-8 lg:text-left">
        © Bifire Şömine · Hesaplar yalnız yönetici davetiyle açılır
      </footer>
    </main>
  );
}
