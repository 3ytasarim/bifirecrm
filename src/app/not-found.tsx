import Link from "next/link";

export default function NotFound() {
  return (
    <main className="grid min-h-dvh place-items-center px-4">
      <div className="max-w-sm text-center">
        <p className="font-display text-5xl font-semibold text-accent">404</p>
        <h1 className="mt-2 font-display text-xl font-semibold">Kayıt bulunamadı</h1>
        <p className="mt-2 text-sm text-muted">Kayıt silinmiş, arşivlenmiş ya da erişim yetkiniz dışında olabilir.</p>
        <Link href="/" className="mt-6 inline-block text-sm text-accent-ink hover:underline">
          Genel bakışa dön
        </Link>
      </div>
    </main>
  );
}
