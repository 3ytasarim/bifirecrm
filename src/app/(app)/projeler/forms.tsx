"use client";

import { ActionForm, Field, SelectField, SubmitButton, TextareaField } from "@/components/ui/form";
import { approveDatesAction, projectStageAction, updateProjectAction } from "./actions";

type Opt = { value: string; label: string };

export type ProjectDefaults = {
  id: string;
  name: string;
  fireplaceType: string | null;
  productCategory: string | null;
  productModel: string | null;
  siteAddress: string | null;
  siteCity: string | null;
  siteDistrict: string | null;
  wallWidthCm: string | null;
  ceilingHeightCm: string | null;
  chimneyStatus: string;
  glassOrientation: string | null;
  cladding: string | null;
  technicalNotes: string | null;
  surveyDate: string;
  ownerId: string | null;
  technicalUserId: string | null;
  installationUserId: string | null;
  plannedShipDate: string;
  plannedInstallDate: string;
  holdReason: string | null;
};

export function ProjectForm({ d, types, chimney, glass, users, readOnly }: { d: ProjectDefaults; types: Opt[]; chimney: Opt[]; glass: Opt[]; users: Opt[]; readOnly?: boolean }) {
  return (
    <ActionForm action={updateProjectAction} className="space-y-6">
      <input type="hidden" name="id" value={d.id} />
      <fieldset disabled={readOnly} className="grid gap-4 sm:grid-cols-2">
        <Field name="name" label="Proje adı" required defaultValue={d.name} className="sm:col-span-2" />
        <SelectField name="fireplaceType" label="Şömine türü" options={types} defaultValue={d.fireplaceType} placeholder="Belirtilmedi" />
        <Field name="productCategory" label="Ürün kategorisi" defaultValue={d.productCategory ?? ""} />
        <Field name="productModel" label="Model" defaultValue={d.productModel ?? ""} />
        <Field name="cladding" label="Kaplama / malzeme" defaultValue={d.cladding ?? ""} placeholder="ör. traverten, mikro beton" />
        <Field name="wallWidthCm" label="Duvar genişliği (cm)" inputMode="decimal" defaultValue={d.wallWidthCm ?? ""} />
        <Field name="ceilingHeightCm" label="Tavan yüksekliği (cm)" inputMode="decimal" defaultValue={d.ceilingHeightCm ?? ""} />
        <SelectField name="chimneyStatus" label="Baca durumu" options={chimney} defaultValue={d.chimneyStatus} />
        <SelectField name="glassOrientation" label="Cam yönü" options={glass} defaultValue={d.glassOrientation} placeholder="Belirtilmedi" />
        <Field name="siteCity" label="Uygulama ili" defaultValue={d.siteCity ?? ""} />
        <Field name="siteDistrict" label="Uygulama ilçesi" defaultValue={d.siteDistrict ?? ""} />
        <TextareaField name="siteAddress" label="Uygulama adresi" rows={2} defaultValue={d.siteAddress} className="sm:col-span-2" />
        <Field name="surveyDate" label="Ölçü / keşif tarihi" type="datetime-local" defaultValue={d.surveyDate} />
        <SelectField name="ownerId" label="Proje sorumlusu" options={users} defaultValue={d.ownerId} placeholder="Atanmamış" />
        <SelectField name="technicalUserId" label="Teknik sorumlu" options={users} defaultValue={d.technicalUserId} placeholder="Atanmamış" />
        <SelectField name="installationUserId" label="Montaj sorumlusu" options={users} defaultValue={d.installationUserId} placeholder="Atanmamış" />
        <Field name="plannedShipDate" label="Planlanan sevkiyat" type="date" defaultValue={d.plannedShipDate} hint="İç planlama — teknik onay olmadan kesin değildir." />
        <Field name="plannedInstallDate" label="Planlanan montaj" type="date" defaultValue={d.plannedInstallDate} hint="Tarih değişirse teknik onay sıfırlanır." />
        <TextareaField name="technicalNotes" label="Teknik notlar" rows={4} defaultValue={d.technicalNotes} className="sm:col-span-2" />
        <Field name="holdReason" label="Bekleme nedeni" defaultValue={d.holdReason ?? ""} className="sm:col-span-2" />
      </fieldset>
      {!readOnly ? (
        <div className="flex justify-end">
          <SubmitButton>Projeyi kaydet</SubmitButton>
        </div>
      ) : null}
    </ActionForm>
  );
}

export function ProjectStageForm({ id, stage, stages }: { id: string; stage: string; stages: Opt[] }) {
  return (
    <ActionForm action={projectStageAction} className="space-y-3">
      <input type="hidden" name="id" value={id} />
      <SelectField name="stage" label="Operasyon aşaması" options={stages} defaultValue={stage} />
      <Field name="note" label="Not" placeholder="Beklemeye alırken neden zorunlu" />
      <SubmitButton className="w-full" variant="secondary">
        Aşamayı güncelle
      </SubmitButton>
    </ActionForm>
  );
}

export function ApproveDatesForm({ id }: { id: string }) {
  return (
    <ActionForm action={approveDatesAction}>
      <input type="hidden" name="id" value={id} />
      <SubmitButton className="w-full">Tarihleri teknik olarak onayla</SubmitButton>
    </ActionForm>
  );
}
