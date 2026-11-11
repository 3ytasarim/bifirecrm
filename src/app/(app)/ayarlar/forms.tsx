"use client";

import { useTransition } from "react";
import { ActionForm, Field, SubmitButton, TextareaField, buttonClass } from "@/components/ui/form";
import { cancelMfaSetup, changePassword, confirmMfa, disableMfa, saveQuoteProfile, startMfa } from "./actions";

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

export function QuoteProfileForm({ header, terms, validityDays }: { header: string; terms: string; validityDays: number }) {
  return (
    <ActionForm action={saveQuoteProfile} className="space-y-3">
      <TextareaField name="header" label="PDF anteti (firma bilgileri)" rows={4} defaultValue={header} required hint="İlk satır firma adı olarak büyük yazılır; diğer satırlar adres, telefon, vergi no vb." />
      <TextareaField name="terms" label="Varsayılan teklif şartları" rows={4} defaultValue={terms} hint="Yeni teklife otomatik eklenir; teklifte değiştirilebilir." />
      <Field name="validityDays" label="Geçerlilik süresi (gün)" type="number" min={1} max={365} defaultValue={validityDays} required className="sm:max-w-[200px]" />
      <SubmitButton variant="secondary">Kaydet</SubmitButton>
    </ActionForm>
  );
}
