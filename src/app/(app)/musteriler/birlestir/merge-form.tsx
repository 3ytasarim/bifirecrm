"use client";

import { ActionForm, CheckboxField, SubmitButton, useFormState } from "@/components/ui/form";
import { mergeAction } from "../actions";

export function MergeForm({ winnerId, loserId }: { winnerId: string; loserId: string }) {
  return (
    <ActionForm action={mergeAction} className="space-y-4">
      <input type="hidden" name="winnerId" value={winnerId} />
      <input type="hidden" name="loserId" value={loserId} />
      <CheckboxField name="confirm" label="Bu iki kaydın aynı kişiye ait olduğunu doğruladım." />
      <ConfirmError />
      <SubmitButton variant="danger">Kayıtları birleştir</SubmitButton>
    </ActionForm>
  );
}

function ConfirmError() {
  const { errors } = useFormState();
  return errors?.confirm ? <p className="text-xs text-danger">{errors.confirm}</p> : null;
}
