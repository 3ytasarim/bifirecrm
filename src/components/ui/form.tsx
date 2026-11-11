"use client";

import { createContext, startTransition, useActionState, useContext, useEffect, useRef, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import { buttonClass, inputClass } from "./styles";

export { buttonClass, inputClass };
import { Loader2 } from "lucide-react";
import type { ActionState } from "@/lib/action";
import { cn } from "./cn";

const FormCtx = createContext<ActionState & { pending?: boolean }>({});
export const useFormState = () => useContext(FormCtx);

type Props = {
  action: (prev: ActionState, fd: FormData) => Promise<ActionState>;
  children: ReactNode;
  className?: string;
  /** Başarıda formu sıfırla (ör. not ekleme). */
  resetOnSuccess?: boolean;
  /** Başarı mesajını gösterme (yalnız yenile). */
  quiet?: boolean;
  onSuccess?: (s: ActionState) => void;
  id?: string;
};

/**
 * Sunucu action'ı ile çalışan form. Alan hataları <Field> bileşenlerine bağlamla iletilir; genel mesaj üstte.
 * Başarıda redirectTo varsa oraya gider, yoksa sayfayı yeniler (sunucu verisi tazelenir).
 */
export function ActionForm({ action, children, className, resetOnSuccess, quiet, onSuccess, id }: Props) {
  const [state, formAction, pending] = useActionState(action, {});
  const router = useRouter();
  const ref = useRef<HTMLFormElement>(null);
  const handled = useRef<ActionState | null>(null);

  useEffect(() => {
    if (!state || handled.current === state) return;
    handled.current = state;
    if (state.ok) {
      if (resetOnSuccess) ref.current?.reset();
      onSuccess?.(state);
      if (state.redirectTo) router.push(state.redirectTo);
      else router.refresh();
    }
  }, [state, router, resetOnSuccess, onSuccess]);

  return (
    <FormCtx.Provider value={{ ...state, pending }}>
      <form
        ref={ref}
        // JS yüklenmeden gönderilirse tarayıcı varsayılanı GET olur ve alanlar (şifre dahil) URL'ye düşer.
        // action={formAction}: hidrasyon öncesi POST (server action, progressive enhancement).
        action={formAction}
        // Hidrasyon sonrası: React 19 action yolu her gönderimde formu sıfırlar; hata durumunda veri kaybolmasın diye
        // onSubmit + preventDefault ile React'in action yolunu atlayıp aynı action'ı elle çağırıyoruz.
        onSubmit={(e) => {
          e.preventDefault();
          const native = e.nativeEvent as SubmitEvent;
          const fd = new FormData(e.currentTarget, native.submitter as HTMLElement | null);
          startTransition(() => formAction(fd));
        }}
        className={className}
        id={id}
        noValidate
      >
        {state.message && !(state.ok && quiet) ? <FormMessage state={state} /> : null}
        {children}
      </form>
    </FormCtx.Provider>
  );
}

export function FormMessage({ state }: { state: ActionState }) {
  return (
    <div
      role={state.ok ? "status" : "alert"}
      className={cn(
        "mb-4 rounded-lg border px-3.5 py-2.5 text-sm",
        state.ok ? "border-success/30 bg-success-soft text-success" : "border-danger/30 bg-danger-soft text-danger",
      )}
    >
      {state.message}
    </div>
  );
}

export function SubmitButton({ children, className, variant = "primary", name, value }: { children: ReactNode; className?: string; variant?: "primary" | "secondary" | "danger"; name?: string; value?: string }) {
  const status = useFormStatus();
  const ctx = useFormState();
  const pending = status.pending || !!ctx.pending;
  return (
    <button
      type="submit"
      name={name}
      value={value}
      disabled={pending}
      aria-busy={pending}
      className={cn(buttonClass(variant), "disabled:opacity-60", className)}
    >
      {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
      {children}
    </button>
  );
}

type FieldProps = {
  name: string;
  label: string;
  hint?: string;
  required?: boolean;
  className?: string;
  children?: ReactNode;
};

/** Etiket + hata + ipucu sarmalayıcı. children verilmezse metin input'u çizer. */
export function Field({ name, label, hint, required, className, children, ...input }: FieldProps & React.InputHTMLAttributes<HTMLInputElement>) {
  const { errors } = useFormState();
  const error = errors?.[name];
  const id = `f-${name}`;
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={id} className="text-[13px] font-medium text-fg">
        {label}
        {required ? <span className="text-danger" aria-hidden> *</span> : null}
      </label>
      {children ?? <input id={id} name={name} required={required} aria-invalid={!!error} aria-describedby={error ? `${id}-err` : hint ? `${id}-hint` : undefined} className={inputClass(!!error)} {...input} />}
      {error ? (
        <p id={`${id}-err`} className="text-xs text-danger">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-xs text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export function SelectField({ name, label, options, defaultValue, required, hint, className, placeholder }: FieldProps & { options: { value: string; label: string }[]; defaultValue?: string | null; placeholder?: string }) {
  const { errors } = useFormState();
  return (
    <Field name={name} label={label} required={required} hint={hint} className={className}>
      <select id={`f-${name}`} name={name} defaultValue={defaultValue ?? ""} aria-invalid={!!errors?.[name]} className={inputClass(!!errors?.[name])}>
        {placeholder !== undefined ? <option value="">{placeholder}</option> : null}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </Field>
  );
}

export function TextareaField({ name, label, defaultValue, rows = 3, hint, className, placeholder, required }: FieldProps & { defaultValue?: string | null; rows?: number; placeholder?: string }) {
  const { errors } = useFormState();
  return (
    <Field name={name} label={label} hint={hint} className={className} required={required}>
      <textarea id={`f-${name}`} name={name} rows={rows} defaultValue={defaultValue ?? ""} placeholder={placeholder} aria-invalid={!!errors?.[name]} className={inputClass(!!errors?.[name])} />
    </Field>
  );
}

export function CheckboxField({ name, label, defaultChecked, hint }: { name: string; label: string; defaultChecked?: boolean; hint?: string }) {
  return (
    <label className="flex cursor-pointer items-start gap-2.5 text-sm">
      <input type="checkbox" name={name} defaultChecked={defaultChecked} className="mt-0.5 size-4 accent-[var(--accent)]" />
      <span>
        {label}
        {hint ? <span className="block text-xs text-muted">{hint}</span> : null}
      </span>
    </label>
  );
}
