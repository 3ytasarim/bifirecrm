import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { ActionForm, Field, SubmitButton } from "@/components/ui/form";
import { login } from "../actions";

export const metadata = { title: "Giriş" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; sifre?: string }> }) {
  if (await getCurrentUser()) redirect("/");
  const sp = await searchParams;
  return (
    <>
      <h1 className="mb-1 font-display text-3xl font-bold tracking-tight">Giriş yap</h1>
      <p className="mb-6 text-sm text-muted">Ekip hesabınızla devam edin.</p>
      {sp.sifre === "tamam" ? (
        <p role="status" className="mb-4 rounded-lg border border-success/30 bg-success-soft px-3.5 py-2.5 text-sm text-success">
          Şifreniz kaydedildi. Yeni şifrenizle giriş yapın.
        </p>
      ) : null}
      <ActionForm action={login} className="flex flex-col gap-4">
        <input type="hidden" name="next" value={sp.next ?? ""} />
        <Field name="email" label="E-posta" type="email" autoComplete="username" required autoFocus />
        <Field name="password" label="Şifre" type="password" autoComplete="current-password" required />
        <SubmitButton className="mt-2 w-full">Giriş yap</SubmitButton>
        <Link href="/sifremi-unuttum" className="text-center text-sm text-accent-ink hover:underline">
          Şifremi unuttum
        </Link>
      </ActionForm>
    </>
  );
}
