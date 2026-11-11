"use client";

import { useState } from "react";
import { ActionForm, CheckboxField, Field, SelectField, SubmitButton, TextareaField, useFormState } from "@/components/ui/form";
import type { DuplicateCandidate } from "@/lib/services/contacts";
import { quickIntakeAction } from "../actions";

type Opt = { value: string; label: string };

/** Bekleyen (ör. web formundan gelen, birden çok müşteriyle eşleşen) talebi işlerken alanlar talepten dolar. */
export type LeadPrefill = { leadId: string; name: string; phone: string | null; email: string | null; district: string | null; source: string; productCategory: string | null; productModel: string | null; message: string | null; kvkkNotice: boolean };

export function IntakeForm({ sources, fireplaceTypes, users, defaultOwner, canAssign, prefill }: { sources: Opt[]; fireplaceTypes: Opt[]; users: Opt[]; defaultOwner: string; canAssign: boolean; prefill?: LeadPrefill }) {
  return (
    <ActionForm action={quickIntakeAction} className="grid gap-6 lg:grid-cols-3">
      {prefill ? <input type="hidden" name="leadId" value={prefill.leadId} /> : null}
      <div className="space-y-6 lg:col-span-2">
        <fieldset className="grid gap-4 rounded-xl border border-line bg-surface p-5 shadow-card sm:grid-cols-2">
          <legend className="px-1 font-display text-[15px] font-semibold">Kişi</legend>
          <Field name="name" label="Ad soyad" required autoComplete="off" className="sm:col-span-2" defaultValue={prefill?.name} />
          <Field name="phone" label="Telefon" type="tel" inputMode="tel" placeholder="0532 123 45 67" hint="Telefon veya e-posta zorunlu." defaultValue={prefill?.phone ?? undefined} />
          <Field name="email" label="E-posta" type="email" defaultValue={prefill?.email ?? undefined} />
          <Field name="city" label="İl" placeholder="İstanbul" />
          <Field name="district" label="İlçe" placeholder="Tuzla" defaultValue={prefill?.district ?? undefined} />
        </fieldset>
        <fieldset className="grid gap-4 rounded-xl border border-line bg-surface p-5 shadow-card sm:grid-cols-2">
          <legend className="px-1 font-display text-[15px] font-semibold">Talep</legend>
          <SelectField name="source" label="Kaynak" options={sources} defaultValue={prefill?.source ?? "PHONE"} required />
          <SelectField name="fireplaceType" label="Şömine türü" options={fireplaceTypes} placeholder="Belirtilmedi" />
          <Field name="productCategory" label="Ürün kategorisi" placeholder="ör. L tipi odunlu" defaultValue={prefill?.productCategory ?? undefined} />
          <Field name="productModel" label="Model" placeholder="ör. BF-90" defaultValue={prefill?.productModel ?? undefined} />
          <TextareaField name="message" label="Not / müşterinin talebi" rows={4} className="sm:col-span-2" defaultValue={prefill?.message} />
        </fieldset>
      </div>
      <div className="space-y-6">
        <fieldset className="space-y-4 rounded-xl border border-line bg-surface p-5 shadow-card">
          <legend className="px-1 font-display text-[15px] font-semibold">Atama ve izinler</legend>
          {canAssign ? <SelectField name="ownerId" label="Sorumlu" options={users} defaultValue={defaultOwner} /> : <input type="hidden" name="ownerId" value={defaultOwner} />}
          <CheckboxField name="kvkkNotice" label="KVKK aydınlatma metni müşteriye iletildi" hint="Kanıt olarak kaydedilir." defaultChecked={prefill?.kvkkNotice} />
          <CheckboxField name="marketingConsent" label="Müşteri pazarlama iletişimine açık izin verdi" hint="Aydınlatmadan ayrı, ayrı kanıtla tutulur." />
        </fieldset>
        <DuplicateChooser />
        <SubmitButton className="w-full">Kaydet ve fırsat aç</SubmitButton>
        <p className="text-xs text-muted">Kayıtla birlikte 24 saat vadeli “İlk dönüş” görevi sorumluya atanır. Müşteriye otomatik mesaj gönderilmez.</p>
      </div>
    </ActionForm>
  );
}

/** Sunucu eşleşen müşteri bulduysa seçim ister: mevcut kayda bağla ya da bilerek yeni müşteri aç. */
function DuplicateChooser() {
  const state = useFormState();
  const candidates = (state.data as { candidates?: DuplicateCandidate[] } | undefined)?.candidates;
  const [choice, setChoice] = useState<string>("");
  if (!candidates?.length) return null;
  return (
    <fieldset className="space-y-3 rounded-xl border border-warning/40 bg-warning-soft p-4">
      <legend className="px-1 text-sm font-semibold text-warning">Eşleşen müşteri bulundu</legend>
      {candidates.map((c) => (
        <label key={c.id} className={`flex items-start gap-2.5 rounded-lg border bg-surface p-3 text-sm ${c.visible ? "cursor-pointer border-line" : "cursor-not-allowed border-line opacity-70"}`}>
          <input type="radio" name="contactChoice" value={c.id} disabled={!c.visible} checked={choice === c.id} onChange={() => setChoice(c.id)} className="mt-1 accent-[var(--accent)]" />
          <span>
            <span className="block font-medium">
              {c.fullName} <span className="text-xs text-muted">M-{String(c.number).padStart(6, "0")}</span>
            </span>
            {c.visible ? (
              <span className="block text-xs text-muted">{[c.primaryPhone, c.primaryEmail, c.district].filter(Boolean).join(" · ")}</span>
            ) : (
              <span className="block text-xs text-muted">Bu kayda erişiminiz yok — yöneticinize bildirin, yeni kart açmayın.</span>
            )}
            <span className="mt-1 block text-xs text-warning">Eşleşme: {c.matchedOn.map((m) => (m === "phone" ? "telefon" : "e-posta")).join(" + ")}</span>
          </span>
        </label>
      ))}
      <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-line bg-surface p-3 text-sm">
        <input type="radio" name="contactChoice" value="new" checked={choice === "new"} onChange={() => setChoice("new")} className="mt-1 accent-[var(--accent)]" />
        <span>
          <span className="block font-medium">Farklı kişi — yeni müşteri aç</span>
          <span className="block text-xs text-muted">Yalnız gerçekten farklı bir kişiyse seçin.</span>
        </span>
      </label>
    </fieldset>
  );
}
