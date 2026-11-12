"use client";

import { useState } from "react";
import { ActionForm, Field, SubmitButton, useFormState } from "@/components/ui/form";
import { inputClass } from "@/components/ui/styles";
import { assignConversationAction, sendTemplateAction } from "./actions";

export type TemplateOption = { id: string; name: string; language: string; category: string; categoryLabel: string; body: string; paramCount: number };

const fill = (body: string, params: string[]) => body.replace(/\{\{\s*(\d+)\s*\}\}/g, (all, n: string) => params[Number(n) - 1]?.trim() || all);

/** Yalnız onaylı şablon seçilebilir; değişkenler doldurulunca önizleme müşterinin göreceği metni gösterir. */
export function TemplateSendForm({ templates, conversationId, contactId }: { templates: TemplateOption[]; conversationId?: string; contactId?: string }) {
  const [id, setId] = useState("");
  const [params, setParams] = useState<string[]>([]);
  const tpl = templates.find((t) => t.id === id);
  return (
    <ActionForm action={sendTemplateAction} className="space-y-3" resetOnSuccess onSuccess={() => (setId(""), setParams([]))}>
      {conversationId ? <input type="hidden" name="conversationId" value={conversationId} /> : null}
      {contactId ? <input type="hidden" name="contactId" value={contactId} /> : null}
      <Field name="templateId" label="Onaylı şablon" required>
        <select
          id="f-templateId"
          name="templateId"
          value={id}
          onChange={(e) => {
            const next = templates.find((t) => t.id === e.target.value);
            setId(e.target.value);
            setParams(Array.from({ length: next?.paramCount ?? 0 }, () => ""));
          }}
          className={inputClass(false)}
        >
          <option value="">Şablon seçin…</option>
          {templates.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name} ({t.language}) · {t.categoryLabel}
            </option>
          ))}
        </select>
      </Field>
      {tpl
        ? params.map((p, i) => (
            <label key={`${tpl.id}-${i}`} className="flex flex-col gap-1.5 text-[13px] font-medium text-fg">
              <span>
                Değişken {`{{${i + 1}}}`}
                <span className="text-danger" aria-hidden>
                  {" "}
                  *
                </span>
              </span>
              <input name="param" value={p} maxLength={1024} required onChange={(e) => setParams((xs) => xs.map((x, j) => (j === i ? e.target.value : x)))} className={inputClass(false)} />
            </label>
          ))
        : null}
      {tpl ? (
        <div>
          <p className="mb-1 text-xs font-medium text-muted">Önizleme</p>
          <p className="whitespace-pre-wrap rounded-lg border border-line bg-surface-2/60 p-3 text-sm">{fill(tpl.body, params)}</p>
          {tpl.category === "MARKETING" ? <p className="mt-1 text-xs text-muted">Pazarlama şablonu: müşterinin kayıtlı WhatsApp pazarlama izni yoksa gönderilmez.</p> : null}
        </div>
      ) : null}
      <SubmitButton>WhatsApp ile gönder</SubmitButton>
    </ActionForm>
  );
}

export function AssignForm({ id, current, users }: { id: string; current: string | null; users: { id: string; name: string }[] }) {
  return (
    <ActionForm action={assignConversationAction} className="flex flex-wrap items-end gap-2" quiet>
      <input type="hidden" name="id" value={id} />
      <AssignSelect current={current} users={users} />
      <SubmitButton variant="secondary">Ata</SubmitButton>
    </ActionForm>
  );
}

function AssignSelect({ current, users }: { current: string | null; users: { id: string; name: string }[] }) {
  const { message, ok } = useFormState();
  return (
    <label className="text-xs text-muted">
      Sorumlu
      <select name="userId" defaultValue={current ?? ""} className={`${inputClass(false)} mt-1 block`} aria-describedby={message ? "assign-msg" : undefined}>
        <option value="">Atanmamış</option>
        {users.map((u) => (
          <option key={u.id} value={u.id}>
            {u.name}
          </option>
        ))}
      </select>
      {message && !ok ? (
        <span id="assign-msg" className="mt-1 block text-danger">
          {message}
        </span>
      ) : null}
    </label>
  );
}
