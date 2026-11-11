export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="grid min-h-dvh place-items-center px-4 py-10">
      <div className="w-full max-w-[400px]">
        <div className="mb-8 text-center">
          <p className="font-display text-2xl font-semibold tracking-[0.18em] text-fg">BİFİRE</p>
          <p className="mt-1 text-xs uppercase tracking-[0.22em] text-muted">Müşteri & Proje Yönetimi</p>
        </div>
        <div className="rounded-2xl border border-line bg-surface p-6 shadow-card sm:p-8">{children}</div>
      </div>
    </main>
  );
}
