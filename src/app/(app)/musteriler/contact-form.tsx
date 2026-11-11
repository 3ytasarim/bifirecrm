"use client";

import Link from "next/link";
import { ActionForm, CheckboxField, Field, SelectField, SubmitButton, TextareaField, useFormState } from "@/components/ui/form";
import type { DuplicateCandidate } from "@/lib/services/contacts";
import type { ActionState } from "@/lib/action";

type Opt = { value: string; label: string };
export type ContactDefaults = {
  id?: string;
  firstName?: string;
  lastName?: string | null;
  title?: string | null;
  organizationName?: string | null;
  phone?: string | null;
  email?: string | null;
  city?: string | null;
  district?: string | null;
  address?: string | null;
  preferredChannel?: string;
  source?: string;
  tags?: string[];
  notes?: string | null;
  ownerId?: string | null;
  kvkkNotice?: boolean;
  marketingConsent?: boolean;
};

export function ContactForm({
  action,
  d,
  sources,
  channels,
  users,
  canAssign,
}: {
  action: (s: ActionState, fd: FormData) => Promise<ActionState>;
  d: ContactDefaults;
  sources: Opt[];
  channels: Opt[];
  users: Opt[];
  canAssign: boolean;
}) {
  return (
    <ActionForm action={action} className="grid gap-6 lg:grid-cols-3">
      {d.id ? <input type="hidden" name="id" value={d.id} /> : null}
      <div className="space-y-6 lg:col-span-2">
        <fieldset className="grid gap-4 rounded-xl border border-line bg-surface p-5 shadow-card sm:grid-cols-2">
          <legend className="px-1 font-display text-[15px] font-semibold">Kimlik ve iletişim</legend>
          <Field name="firstName" label="Ad" required defaultValue={d.firstName} />
          <Field name="lastName" label="Soyad" defaultValue={d.lastName ?? ""} />
          <Field name="phone" label="Telefon" type="tel" defaultValue={d.phone ?? ""} hint="Eşleştirme için E.164 biçimine çevrilir." />
          <Field name="email" label="E-posta" type="email" defaultValue={d.email ?? ""} />
          <Field name="organizationName" label="Şirket / kurum" defaultValue={d.organizationName ?? ""} hint="İsteğe bağlı (mimar, müteahhit, otel…)." />
          <Field name="title" label="Unvan" defaultValue={d.title ?? ""} />
          <SelectField name="preferredChannel" label="Tercih ettiği kanal" options={channels} defaultValue={d.preferredChannel ?? "ANY"} />
          <SelectField name="source" label="İlk kaynak" options={sources} defaultValue={d.source ?? "MANUAL"} />
        </fieldset>
        <fieldset className="grid gap-4 rounded-xl border border-line bg-surface p-5 shadow-card sm:grid-cols-2">
          <legend className="px-1 font-display text-[15px] font-semibold">Adres</legend>
          <Field name="city" label="İl" defaultValue={d.city ?? ""} />
          <Field name="district" label="İlçe" defaultValue={d.district ?? ""} />
          <TextareaField name="address" label="Açık adres" rows={2} defaultValue={d.address} className="sm:col-span-2" />
        </fieldset>
        <fieldset className="grid gap-4 rounded-xl border border-line bg-surface p-5 shadow-card">
          <legend className="px-1 font-display text-[15px] font-semibold">Notlar</legend>
          <Field name="tags" label="Etiketler" defaultValue={d.tags?.join(", ") ?? ""} hint="Virgülle ayırın: mimar, vip, otel" />
          <TextareaField name="notes" label="Genel not" rows={3} defaultValue={d.notes} />
        </fieldset>
      </div>
      <div className="space-y-6">
        <fieldset className="space-y-4 rounded-xl border border-line bg-surface p-5 shadow-card">
          <legend className="px-1 font-display text-[15px] font-semibold">Sorumlu ve KVKK</legend>
          {canAssign ? <SelectField name="ownerId" label="Müşteri sorumlusu" options={users} defaultValue={d.ownerId ?? ""} placeholder="Atanmamış" /> : null}
          <CheckboxField name="kvkkNotice" label="KVKK aydınlatma metni iletildi" defaultChecked={d.kvkkNotice} hint="İlk işaretlemede zaman damgası ve kanıt kaydı oluşur." />
          <CheckboxField name="marketingConsent" label="Pazarlama iletişimine açık izin" defaultChecked={d.marketingConsent} hint="Ayrı izin; geri alınırsa kayıt düşülür." />
        </fieldset>
        <Duplicates />
        <SubmitButton className="w-full">{d.id ? "Değişiklikleri kaydet" : "Müşteriyi oluştur"}</SubmitButton>
      </div>
    </ActionForm>
  );
}

function Duplicates() {
  const state = useFormState();
  const candidates = (state.data as { candidates?: DuplicateCandidate[] } | undefined)?.candidates;
  if (!candidates?.length) return null;
  return (
    <div className="space-y-3 rounded-xl border border-warning/40 bg-warning-soft p-4 text-sm">
      <p className="font-semibold text-warning">Olası aynı kişi</p>
      <ul className="space-y-2">
        {candidates.map((c) => (
          <li key={c.id} className="rounded-lg border border-line bg-surface p-3">
            {c.visible ? (
              <Link href={`/musteriler/${c.id}`} className="font-medium text-accent-ink hover:underline">
                {c.fullName}
              </Link>
            ) : (
              <span className="font-medium">{c.fullName}</span>
            )}
            <span className="block text-xs text-muted">
              M-{String(c.number).padStart(6, "0")} · eşleşme: {c.matchedOn.map((m) => (m === "phone" ? "telefon" : "e-posta")).join(" + ")}
            </span>
          </li>
        ))}
      </ul>
      <CheckboxField name="confirmNew" label="Farklı bir kişi; yine de yeni kayıt aç" />
    </div>
  );
}
