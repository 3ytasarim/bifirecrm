"use client";

import { useState } from "react";
import { ActionForm, Field, inputClass, SelectField, SubmitButton, TextareaField } from "@/components/ui/form";
import { changeStageAction, createOpportunityAction, createProjectAction, updateOpportunityAction } from "./actions";

type Opt = { value: string; label: string };

export type OppDefaults = {
  id?: string;
  contactId?: string;
  title?: string;
  source?: string;
  ownerId?: string | null;
  fireplaceType?: string | null;
  productCategory?: string | null;
  productModel?: string | null;
  city?: string | null;
  district?: string | null;
  message?: string | null;
  estimatedAmount?: string | null;
  currency?: string;
  expectedCloseDate?: string;
  nextActionAt?: string;
  nextActionNote?: string | null;
};

export function OpportunityForm({ d, sources, types, users, contacts, canAssign }: { d: OppDefaults; sources: Opt[]; types: Opt[]; users: Opt[]; contacts?: Opt[]; canAssign: boolean }) {
  return (
    <ActionForm action={d.id ? updateOpportunityAction : createOpportunityAction} className="grid gap-4 sm:grid-cols-2">
      {d.id ? <input type="hidden" name="id" value={d.id} /> : null}
      {contacts ? (
        <SelectField name="contactId" label="Müşteri" options={contacts} defaultValue={d.contactId} placeholder="Seçin" required className="sm:col-span-2" />
      ) : (
        <input type="hidden" name="contactId" value={d.contactId ?? ""} />
      )}
      <Field name="title" label="Başlık" required defaultValue={d.title} className="sm:col-span-2" />
      <SelectField name="source" label="Kaynak" options={sources} defaultValue={d.source ?? "MANUAL"} />
      {canAssign ? <SelectField name="ownerId" label="Sorumlu" options={users} defaultValue={d.ownerId ?? ""} placeholder="Atanmamış" /> : <span />}
      <SelectField name="fireplaceType" label="Şömine türü" options={types} defaultValue={d.fireplaceType ?? ""} placeholder="Belirtilmedi" />
      <Field name="productCategory" label="Ürün kategorisi" defaultValue={d.productCategory ?? ""} />
      <Field name="productModel" label="Model" defaultValue={d.productModel ?? ""} />
      <div className="grid grid-cols-[1fr_90px] gap-2">
        <Field name="estimatedAmount" label="Tahmini tutar" inputMode="decimal" defaultValue={d.estimatedAmount ?? ""} placeholder="125.000" />
        <SelectField
          name="currency"
          label="Para birimi"
          defaultValue={d.currency ?? "TRY"}
          options={[
            { value: "TRY", label: "TRY" },
            { value: "EUR", label: "EUR" },
            { value: "USD", label: "USD" },
          ]}
        />
      </div>
      <Field name="city" label="İl" defaultValue={d.city ?? ""} />
      <Field name="district" label="İlçe" defaultValue={d.district ?? ""} />
      <Field name="expectedCloseDate" label="Beklenen kapanış" type="date" defaultValue={d.expectedCloseDate} />
      <Field name="nextActionAt" label="Sonraki aksiyon" type="datetime-local" defaultValue={d.nextActionAt} />
      <Field name="nextActionNote" label="Sonraki aksiyon notu" defaultValue={d.nextActionNote ?? ""} className="sm:col-span-2" />
      <TextareaField name="message" label="Müşteri talebi / açıklama" rows={3} defaultValue={d.message} className="sm:col-span-2" />
      <div className="flex justify-end sm:col-span-2">
        <SubmitButton>{d.id ? "Kaydet" : "Fırsatı oluştur"}</SubmitButton>
      </div>
    </ActionForm>
  );
}

export function StageForm({ id, stage, stages, lostReasons }: { id: string; stage: string; stages: Opt[]; lostReasons: string[] }) {
  const [value, setValue] = useState(stage);
  return (
    <ActionForm action={changeStageAction} className="space-y-3">
      <input type="hidden" name="id" value={id} />
      <Field name="stage" label="Aşama">
        <select id="f-stage" name="stage" value={value} onChange={(e) => setValue(e.target.value)} className={inputClass()}>
          {stages.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </Field>
      {value === "LOST" && stage !== "LOST" ? (
        <>
          <SelectField name="lostReason" label="Kayıp nedeni" options={lostReasons.map((r) => ({ value: r, label: r }))} placeholder="Seçin" required />
          <TextareaField name="lostNote" label="Not" rows={2} />
        </>
      ) : null}
      <SubmitButton className="w-full" variant="secondary">
        Aşamayı güncelle
      </SubmitButton>
    </ActionForm>
  );
}

export function ProjectCreateForm({ opportunityId, defaultName, types, chimney, glass, users }: { opportunityId: string; defaultName: string; types: Opt[]; chimney: Opt[]; glass: Opt[]; users: Opt[] }) {
  return (
    <ActionForm action={createProjectAction} className="grid gap-4 sm:grid-cols-2">
      <input type="hidden" name="opportunityId" value={opportunityId} />
      <Field name="name" label="Proje adı" required defaultValue={defaultName} className="sm:col-span-2" />
      <SelectField name="fireplaceType" label="Şömine türü" options={types} placeholder="Fırsattan al" />
      <SelectField name="chimneyStatus" label="Baca durumu" options={chimney} defaultValue="UNKNOWN" />
      <SelectField name="glassOrientation" label="Cam yönü" options={glass} placeholder="Belirtilmedi" />
      <Field name="productModel" label="Model" placeholder="Fırsattan al" />
      <Field name="siteDistrict" label="Uygulama ilçesi" placeholder="Fırsattan al" />
      <Field name="siteAddress" label="Uygulama adresi" />
      <SelectField name="technicalUserId" label="Teknik sorumlu" options={users} placeholder="Sonra atanacak" />
      <SelectField name="installationUserId" label="Montaj sorumlusu" options={users} placeholder="Sonra atanacak" />
      <div className="flex justify-end sm:col-span-2">
        <SubmitButton>Projeyi aç</SubmitButton>
      </div>
    </ActionForm>
  );
}
