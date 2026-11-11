"use client";

import { useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import { ActionForm, Field, SubmitButton, useFormState } from "@/components/ui/form";
import { buttonClass, inputClass } from "@/components/ui/styles";
import { saveTemplateAction, toggleTemplateAction } from "./actions";

type Opt = { value: string; label: string };

export function TemplateForm({ d, channels, variables }: { d: { id?: string; name: string; channel: string; subject: string | null; body: string }; channels: Opt[]; variables: { key: string; label: string }[] }) {
  const [channel, setChannel] = useState(d.channel);
  const [body, setBody] = useState(d.body);
  const ref = useRef<HTMLTextAreaElement>(null);
  const insert = (v: string) => {
    const el = ref.current;
    const token = `{{${v}}}`;
    if (!el) return setBody((b) => b + token);
    const [s, e] = [el.selectionStart, el.selectionEnd];
    const next = body.slice(0, s) + token + body.slice(e);
    setBody(next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(s + token.length, s + token.length);
    });
  };
  return (
    <ActionForm action={saveTemplateAction} className="space-y-4">
      {d.id ? <input type="hidden" name="id" value={d.id} /> : null}
      <div className="grid gap-4 sm:grid-cols-[2fr_1fr]">
        <Field name="name" label="Şablon adı" defaultValue={d.name} required maxLength={120} placeholder="ör. Keşif randevusu onayı" />
        <Field name="channel" label="Kanal" required>
          <select id="f-channel" name="channel" value={channel} onChange={(e) => setChannel(e.target.value)} className={inputClass(false)}>
            {channels.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </Field>
      </div>
      {channel === "EMAIL" ? <Field name="subject" label="E-posta konusu" defaultValue={d.subject ?? ""} maxLength={200} /> : <input type="hidden" name="subject" value="" />}
      <BodyField value={body} onChange={setBody} textareaRef={ref} channel={channel} />
      <div>
        <p className="mb-1.5 text-xs font-medium text-muted">Değişken ekle (imlecin olduğu yere)</p>
        <div className="flex flex-wrap gap-1.5">
          {variables.map((v) => (
            <button key={v.key} type="button" onClick={() => insert(v.key)} title={v.label} className="rounded-full border border-line bg-surface px-2.5 py-1 text-xs hover:border-accent hover:text-accent-ink">
              {`{{${v.key}}}`}
            </button>
          ))}
        </div>
      </div>
      <SubmitButton>{d.id ? "Kaydet" : "Şablon oluştur"}</SubmitButton>
    </ActionForm>
  );
}

function BodyField({ value, onChange, textareaRef, channel }: { value: string; onChange: (v: string) => void; textareaRef: React.RefObject<HTMLTextAreaElement | null>; channel: string }) {
  const { errors } = useFormState();
  return (
    <Field name="body" label="Mesaj metni" required hint={channel === "SMS" ? `${value.length}/900 karakter` : undefined}>
      <textarea ref={textareaRef} id="f-body" name="body" rows={8} value={value} onChange={(e) => onChange(e.target.value)} aria-invalid={!!errors?.body} className={inputClass(!!errors?.body)} />
    </Field>
  );
}

export function ToggleTemplate({ id, active }: { id: string; active: boolean }) {
  return (
    <ActionForm action={toggleTemplateAction} quiet>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="active" value={active ? "0" : "1"} />
      <SubmitButton variant={active ? "danger" : "secondary"}>{active ? "Arşivle" : "Yeniden etkinleştir"}</SubmitButton>
    </ActionForm>
  );
}

export function CopyText({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className={buttonClass("secondary", "sm")}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 2000);
        } catch {
          setDone(false);
        }
      }}
    >
      {done ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}
      {done ? "Kopyalandı" : "Metni kopyala"}
    </button>
  );
}

