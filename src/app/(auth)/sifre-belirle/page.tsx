import Link from "next/link";
import { findValidToken } from "@/lib/auth/tokens";
import { ActionForm, Field, SubmitButton } from "@/components/ui/form";
import { setPassword } from "../actions";

export const metadata = { title: "Şifre belirle" };

export default async function SetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token = "" } = await searchParams;
  const row = await findValidToken(token);
  if (!row) {
    return (
      <>
        <h1 className="mb-2 font-display text-xl font-semibold">Bağlantı geçersiz</h1>
        <p className="mb-6 text-sm text-muted">Bu bağlantı kullanılmış ya da süresi dolmuş. Yöneticinizden yeni bir bağlantı isteyin.</p>
        <Link href="/giris" className="text-sm text-accent-ink hover:underline">
          Girişe dön
        </Link>
      </>
    );
  }
  return (
    <>
      <h1 className="mb-1 font-display text-xl font-semibold">{row.type === "INVITE" ? `Hoş geldiniz, ${row.user.name}` : "Yeni şifre belirleyin"}</h1>
      <p className="mb-6 text-sm text-muted">{row.user.email} hesabı için şifre belirleyin.</p>
      <ActionForm action={setPassword} className="flex flex-col gap-4">
        <input type="hidden" name="token" value={token} />
        <input type="hidden" name="username" value={row.user.email} autoComplete="username" />
        <Field name="password" label="Yeni şifre" type="password" autoComplete="new-password" required hint="En az 12 karakter; büyük harf, küçük harf ve rakam." />
        <Field name="confirm" label="Yeni şifre (tekrar)" type="password" autoComplete="new-password" required />
        <SubmitButton className="w-full">Şifreyi kaydet</SubmitButton>
      </ActionForm>
    </>
  );
}
