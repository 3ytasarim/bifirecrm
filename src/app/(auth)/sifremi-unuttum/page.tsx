import Link from "next/link";
import { ActionForm, Field, SubmitButton } from "@/components/ui/form";
import { mailConfigured } from "@/lib/mailer";
import { requestPasswordReset } from "../actions";

export const metadata = { title: "Şifremi unuttum" };

export default function ForgotPage() {
  const smtp = mailConfigured();
  return (
    <>
      <h1 className="mb-1 font-display text-xl font-semibold">Şifremi unuttum</h1>
      <p className="mb-6 text-sm text-muted">Hesabınızın e-posta adresini yazın; şifre belirleme bağlantısı gönderelim.</p>
      {!smtp ? (
        <p className="mb-4 rounded-lg border border-warning/30 bg-warning-soft px-3.5 py-2.5 text-sm text-warning">
          E-posta gönderimi henüz yapılandırılmadı. Yöneticiniz Kullanıcılar ekranından size sıfırlama bağlantısı oluşturabilir.
        </p>
      ) : null}
      <ActionForm action={requestPasswordReset} className="flex flex-col gap-4">
        <Field name="email" label="E-posta" type="email" autoComplete="username" required />
        <SubmitButton className="w-full">Bağlantı gönder</SubmitButton>
        <Link href="/giris" className="text-center text-sm text-accent-ink hover:underline">
          Girişe dön
        </Link>
      </ActionForm>
    </>
  );
}
