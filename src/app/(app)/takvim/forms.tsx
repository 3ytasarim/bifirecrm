"use client";

import { useState } from "react";
import { ActionForm, CheckboxField, Field, SelectField, SubmitButton, TextareaField } from "@/components/ui/form";
import { appointmentStatusAction, saveAppointmentAction } from "./actions";

type Opt = { value: string; label: string };

export type AppointmentFormData = {
  id?: string;
  contactId: string;
  type: string;
  status: string;
  opportunityId: string | null;
  projectId: string | null;
  startAt: string;
  endAt: string;
  location: string | null;
  assignedUserId: string | null;
  requestedNote: string | null;
  notes: string | null;
};

/** "YYYY-MM-DDTHH:mm" + dakika (İstanbul yerel değeri, saat dilimi kayması olmadan). */
function addMinutes(local: string, min: number) {
  const d = new Date(`${local}:00Z`);
  if (Number.isNaN(d.getTime())) return "";
  return new Date(d.getTime() + min * 60_000).toISOString().slice(0, 16);
}

export function AppointmentForm({ d, types, statuses, users, opportunities, projects }: { d: AppointmentFormData; types: Opt[]; statuses: Opt[]; users: Opt[]; opportunities: Opt[]; projects: Opt[] }) {
  const [start, setStart] = useState(d.startAt);
  const [end, setEnd] = useState(d.endAt);
  return (
    <ActionForm action={saveAppointmentAction} className="grid gap-4 sm:grid-cols-2">
      {d.id ? <input type="hidden" name="id" value={d.id} /> : null}
      <input type="hidden" name="contactId" value={d.contactId} />
      <SelectField name="type" label="Tür" options={types} defaultValue={d.type} required />
      <SelectField name="status" label="Durum" options={statuses} defaultValue={d.status} required />
      <Field
        name="startAt"
        label="Başlangıç"
        type="datetime-local"
        value={start}
        onChange={(e) => {
          const v = e.currentTarget.value;
          // Bitiş boşsa ya da başlangıçtan önceye düştüyse 1 saat sonrasını öner.
          if (v && (!end || end <= v)) setEnd(addMinutes(v, 60));
          setStart(v);
        }}
        hint="Saat henüz belli değilse boş bırakıp durumu “Talep edildi” seçin."
      />
      <Field name="endAt" label="Bitiş" type="datetime-local" value={end} min={start || undefined} onChange={(e) => setEnd(e.currentTarget.value)} />
      <SelectField name="assignedUserId" label="Atanan kişi" options={users} defaultValue={d.assignedUserId} placeholder="Atanmamış" />
      <Field name="location" label="Yer" defaultValue={d.location ?? ""} placeholder="ör. Showroom ya da müşteri adresi" maxLength={300} />
      {opportunities.length ? <SelectField name="opportunityId" label="Fırsat" options={opportunities} defaultValue={d.opportunityId} placeholder="Bağlama" /> : <input type="hidden" name="opportunityId" value="" />}
      {projects.length ? <SelectField name="projectId" label="Proje" options={projects} defaultValue={d.projectId} placeholder="Bağlama" /> : <input type="hidden" name="projectId" value="" />}
      <TextareaField name="requestedNote" label="Müşterinin tercihi" rows={2} defaultValue={d.requestedNote} placeholder="ör. Cumartesi öğleden sonra" className="sm:col-span-2" />
      <TextareaField name="notes" label="Notlar" rows={3} defaultValue={d.notes} className="sm:col-span-2" />
      <div className="sm:col-span-2">
        <CheckboxField name="allowOverlap" label="Çakışmaya rağmen kaydet" hint="Atanan kişinin aynı saatte başka randevusu varsa sistem uyarır; bilerek çift randevu vermek için işaretleyin." />
      </div>
      <div className="sm:col-span-2">
        <SubmitButton>{d.id ? "Kaydet" : "Randevu oluştur"}</SubmitButton>
      </div>
    </ActionForm>
  );
}

export function StatusButtons({ id, options }: { id: string; options: { value: string; label: string; variant?: "primary" | "secondary" | "danger" }[] }) {
  return (
    <ActionForm action={appointmentStatusAction} className="flex flex-wrap gap-2">
      <input type="hidden" name="id" value={id} />
      {options.map((o) => (
        <SubmitButton key={o.value} name="status" value={o.value} variant={o.variant ?? "secondary"}>
          {o.label}
        </SubmitButton>
      ))}
    </ActionForm>
  );
}
