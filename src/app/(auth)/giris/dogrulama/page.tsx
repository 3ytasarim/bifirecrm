import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { ActionForm, Field, SubmitButton } from "@/components/ui/form";
import { logout, verifyMfa } from "../../actions";

export const metadata = { title: "İki adımlı doğrulama" };

export default async function MfaPage() {
  const s = await getSession();
  if (!s) redirect("/giris");
  if (!s.mfaPending) redirect("/");
  return (
    <>
      <h1 className="mb-1 font-display text-xl font-semibold">İki adımlı doğrulama</h1>
      <p className="mb-6 text-sm text-muted">Doğrulama uygulamanızdaki 6 haneli kodu girin.</p>
      <ActionForm action={verifyMfa} className="flex flex-col gap-4">
        <Field name="code" label="Doğrulama kodu" inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} required autoFocus />
        <SubmitButton className="w-full">Doğrula</SubmitButton>
      </ActionForm>
      <form action={logout} className="mt-4 text-center">
        <button className="text-sm text-muted hover:text-fg">Vazgeç ve çık</button>
      </form>
    </>
  );
}
