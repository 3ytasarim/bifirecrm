"use client";

import { ActionForm, SubmitButton, TextareaField } from "@/components/ui/form";
import { customerResponseAction, decideQuoteAction, deleteDraftAction, markSentAction, reviseQuoteAction, submitQuoteAction } from "./actions";

const ACTIONS = {
  submit: submitQuoteAction,
  sent: markSentAction,
  revise: reviseQuoteAction,
  delete: deleteDraftAction,
} as const;

/** Tek düğmelik durum geçişi (onaya gönder, gönderildi, revize, taslağı sil). */
export function QuoteStepButton({ id, kind, label, variant = "primary" }: { id: string; kind: keyof typeof ACTIONS; label: string; variant?: "primary" | "secondary" | "danger" }) {
  return (
    <ActionForm action={ACTIONS[kind]}>
      <input type="hidden" name="id" value={id} />
      <SubmitButton variant={variant} className="w-full">
        {label}
      </SubmitButton>
    </ActionForm>
  );
}

/** Onay/ret: ret için gerekçe zorunlu (sunucu da kontrol eder). */
export function DecisionForm({ id }: { id: string }) {
  return (
    <ActionForm action={decideQuoteAction} className="space-y-3">
      <input type="hidden" name="id" value={id} />
      <TextareaField name="note" label="Not" rows={2} hint="Reddederken gerekçe zorunludur." />
      <div className="grid grid-cols-2 gap-2">
        <SubmitButton name="decision" value="APPROVED">
          Onayla
        </SubmitButton>
        <SubmitButton name="decision" value="REJECTED" variant="danger">
          Reddet
        </SubmitButton>
      </div>
    </ActionForm>
  );
}

export function CustomerResponseForm({ id }: { id: string }) {
  return (
    <ActionForm action={customerResponseAction} className="space-y-3">
      <input type="hidden" name="id" value={id} />
      <TextareaField name="note" label="Not (isteğe bağlı)" rows={2} />
      <div className="grid grid-cols-2 gap-2">
        <SubmitButton name="response" value="ACCEPTED">
          Kabul etti
        </SubmitButton>
        <SubmitButton name="response" value="REJECTED" variant="secondary">
          Reddetti
        </SubmitButton>
      </div>
    </ActionForm>
  );
}
