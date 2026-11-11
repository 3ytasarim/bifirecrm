import Link from "next/link";
import { ShieldAlert } from "lucide-react";

export const metadata = { title: "Yetkisiz" };

export default function Forbidden() {
  return (
    <main className="grid min-h-dvh place-items-center px-4">
      <div className="max-w-sm text-center">
        <ShieldAlert className="mx-auto mb-3 size-10 text-danger" aria-hidden />
        <h1 className="font-display text-xl font-semibold">Bu sayfaya erişim yetkiniz yok</h1>
        <p className="mt-2 text-sm text-muted">Rolünüz bu işlem için yetkili değil. Gerekliyse yöneticinizden yetki isteyin.</p>
        <Link href="/" className="mt-6 inline-block text-sm text-accent-ink hover:underline">
          Genel bakışa dön
        </Link>
      </div>
    </main>
  );
}
