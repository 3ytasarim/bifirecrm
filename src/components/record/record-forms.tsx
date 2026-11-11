"use client";

import { useState } from "react";
import { ActionForm, CheckboxField, Field, SelectField, SubmitButton, TextareaField } from "@/components/ui/form";
import { addNote, logActivity, saveTask, uploadFiles } from "@/app/(app)/_record/actions";
import type { RecordRef } from "@/lib/services/records";
import { cn } from "@/components/ui/cn";

type Opt = { value: string; label: string };

function Hidden({ record }: { record: RecordRef }) {
  return (
    <>
      <input type="hidden" name="recordKind" value={record.kind} />
      <input type="hidden" name="recordId" value={record.id} />
    </>
  );
}

/** Not ekle / görüşme kaydet — tek kartta iki sekme. */
export function TimelineComposer({ record, activityTypes, nowLocal }: { record: RecordRef; activityTypes: Opt[]; nowLocal: string }) {
  const [mode, setMode] = useState<"note" | "activity">("note");
  return (
    <div className="rounded-xl border border-line bg-surface shadow-card">
      <div role="tablist" aria-label="Kayıt türü" className="flex gap-1 border-b border-line px-3 pt-2">
        {(
          [
            ["note", "Not ekle"],
            ["activity", "Görüşme kaydet"],
          ] as const
        ).map(([k, l]) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={mode === k}
            onClick={() => setMode(k)}
            className={cn("-mb-px min-h-10 border-b-2 px-3 text-sm", mode === k ? "border-accent font-medium" : "border-transparent text-muted hover:text-fg")}
          >
            {l}
          </button>
        ))}
      </div>
      <div className="p-4">
        {mode === "note" ? (
          <ActionForm action={addNote} resetOnSuccess quiet className="space-y-3">
            <Hidden record={record} />
            <TextareaField name="body" label="Not" rows={3} placeholder="Müşteriyle ilgili iç not…" />
            <div className="flex flex-wrap items-center justify-between gap-3">
              <CheckboxField name="pinned" label="Üste sabitle" />
              <SubmitButton>Notu kaydet</SubmitButton>
            </div>
          </ActionForm>
        ) : (
          <ActionForm action={logActivity} resetOnSuccess quiet className="grid gap-3 sm:grid-cols-3">
            <Hidden record={record} />
            <SelectField name="type" label="Tür" options={activityTypes} defaultValue="CALL" />
            <Field name="occurredAt" label="Zaman" type="datetime-local" defaultValue={nowLocal} />
            <Field name="durationMin" label="Süre (dk)" type="number" min={0} max={1440} inputMode="numeric" />
            <Field name="subject" label="Konu" className="sm:col-span-3" />
            <TextareaField name="body" label="Görüşme notu" rows={3} className="sm:col-span-3" />
            <div className="sm:col-span-3 flex justify-end">
              <SubmitButton>Görüşmeyi kaydet</SubmitButton>
            </div>
          </ActionForm>
        )}
      </div>
    </div>
  );
}

export function TaskForm({
  record,
  users,
  defaultAssignee,
  priorities,
  task,
  statuses,
  onDone,
}: {
  record?: RecordRef;
  users: Opt[];
  defaultAssignee: string;
  priorities: Opt[];
  statuses?: Opt[];
  task?: { id: string; title: string; description: string | null; priority: string; status: string; dueLocal: string; remindLocal: string; repeatMinutes: number | null; assigneeId: string | null };
  onDone?: () => void;
}) {
  return (
    <ActionForm action={saveTask} resetOnSuccess={!task} onSuccess={onDone} className="grid gap-3 sm:grid-cols-2">
      {record ? <Hidden record={record} /> : null}
      {task ? <input type="hidden" name="id" value={task.id} /> : null}
      <Field name="title" label="Görev" required defaultValue={task?.title} className="sm:col-span-2" />
      <SelectField name="assigneeId" label="Sorumlu" options={users} defaultValue={task?.assigneeId ?? defaultAssignee} />
      <SelectField name="priority" label="Öncelik" options={priorities} defaultValue={task?.priority ?? "NORMAL"} />
      <Field name="dueAt" label="Son tarih" type="datetime-local" defaultValue={task?.dueLocal} />
      <Field name="remindAt" label="Hatırlat" type="datetime-local" defaultValue={task?.remindLocal} />
      <SelectField
        name="repeatMinutes"
        label="Hatırlatma tekrarı"
        defaultValue={task?.repeatMinutes ? String(task.repeatMinutes) : ""}
        placeholder="Tekrar yok"
        options={[
          { value: "15", label: "15 dakikada bir" },
          { value: "30", label: "30 dakikada bir" },
          { value: "60", label: "Saatte bir" },
          { value: "240", label: "4 saatte bir" },
          { value: "1440", label: "Günde bir" },
        ]}
      />
      {statuses && task ? <SelectField name="status" label="Durum" options={statuses} defaultValue={task.status} /> : null}
      <TextareaField name="description" label="Açıklama" rows={2} defaultValue={task?.description} className="sm:col-span-2" />
      <div className="flex justify-end sm:col-span-2">
        <SubmitButton>{task ? "Görevi güncelle" : "Görev ekle"}</SubmitButton>
      </div>
    </ActionForm>
  );
}

export function UploadForm({ record, kinds, accept, maxMb }: { record: RecordRef; kinds: Opt[]; accept: string; maxMb: number }) {
  return (
    <ActionForm action={uploadFiles} resetOnSuccess className="grid gap-3 sm:grid-cols-[1fr_200px_auto] sm:items-end">
      <Hidden record={record} />
      <Field name="files" label="Dosya(lar)" type="file" multiple accept={accept} hint={`En fazla ${maxMb} MB / dosya. Fotoğraflarda konum (EXIF) bilgisi silinir.`} />
      <SelectField name="kind" label="Belge türü" options={kinds} defaultValue="PHOTO" />
      <SubmitButton>Yükle</SubmitButton>
    </ActionForm>
  );
}
