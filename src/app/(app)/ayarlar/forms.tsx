"use client";

import { useTransition } from "react";
import { ActionForm, Field, SubmitButton, buttonClass } from "@/components/ui/form";
import { cancelMfaSetup, changePassword, confirmMfa, disableMfa, startMfa } from "./actions";

export function PasswordForm({ email }: { email: string }) {
  return (
    <ActionForm action={changePassword} resetOnSuccess className="grid gap-3 sm:max-w-md">
      <input type="hidden" name="username" value={email} autoComplete="username" />
      <Field name="current" label="Mevcut şifre" type="password" autoComplete="current-password" required />
      <Field name="password" label="Yeni şifre" type="password" autoComplete="new-password" required hint="En az 12 karakter; büyük/küçük harf ve rakam." />
      <Field name="confirm" label="Yeni şifre (tekrar)" type="password" autoComplete="new-password" required />
      <div>
        <SubmitButton>Şifreyi değiştir</SubmitButton>
      </div>
    </ActionForm>
  );
}

export function StartMfaButton() {
  const [pending, start] = useTransition();
  return (
    <button type="button" disabled={pending} onClick={() => start(async () => void (await startMfa()))} className={buttonClass()}>
      İki adımlı doğrulamayı kur
    </button>
  );
}

export function ConfirmMfaForm() {
  return (
    <div className="flex flex-wrap items-end gap-3">
      <ActionForm action={confirmMfa} className="flex flex-wrap items-end gap-3">
        <Field name="code" label="Uygulamadaki 6 haneli kod" inputMode="numeric" autoComplete="one-time-code" maxLength={6} required />
        <SubmitButton>Doğrula ve aç</SubmitButton>
      </ActionForm>
      <form action={cancelMfaSetup}>
        <button className={buttonClass("ghost")}>Vazgeç</button>
      </form>
    </div>
  );
}

export function DisableMfaForm() {
  return (
    <ActionForm action={disableMfa} className="flex flex-wrap items-end gap-3">
      <Field name="code" label="Kapatmak için güncel kod" inputMode="numeric" autoComplete="one-time-code" maxLength={6} required />
      <SubmitButton variant="danger">MFA’yı kapat</SubmitButton>
    </ActionForm>
  );
}
