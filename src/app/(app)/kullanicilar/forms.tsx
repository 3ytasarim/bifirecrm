"use client";

import { useState } from "react";
import { ActionForm, Field, SelectField, SubmitButton, useFormState } from "@/components/ui/form";
import { inviteUser, resetLink, savePermissions, updateUser } from "./actions";

type Opt = { value: string; label: string };

function LinkBox() {
  const state = useFormState();
  const link = (state.data as { link?: string } | undefined)?.link;
  const [copied, setCopied] = useState(false);
  if (!link) return null;
  return (
    <div className="mt-2 flex gap-2">
      <input readOnly value={link} className="min-h-9 flex-1 rounded-lg border border-line bg-surface-2 px-2 text-xs" aria-label="Tek kullanımlık bağlantı" onFocus={(e) => e.currentTarget.select()} />
      <button
        type="button"
        className="rounded-lg border border-line px-3 text-xs hover:bg-surface-2"
        onClick={async () => {
          await navigator.clipboard.writeText(link);
          setCopied(true);
        }}
      >
        {copied ? "Kopyalandı" : "Kopyala"}
      </button>
    </div>
  );
}

export function InviteForm({ roles }: { roles: Opt[] }) {
  return (
    <ActionForm action={inviteUser} resetOnSuccess className="grid gap-3 sm:grid-cols-[1fr_1fr_200px_auto] sm:items-end">
      <Field name="name" label="Ad soyad" required />
      <Field name="email" label="E-posta" type="email" required />
      <SelectField name="role" label="Rol" options={roles} defaultValue="SALES" />
      <SubmitButton>Davet et</SubmitButton>
      <div className="sm:col-span-4">
        <LinkBox />
      </div>
    </ActionForm>
  );
}

export function UserRow({ id, role, status, roles, canRoles, self }: { id: string; role: string; status: string; roles: Opt[]; canRoles: boolean; self: boolean }) {
  return (
    <div className="flex flex-col gap-2">
      <ActionForm action={updateUser} quiet={false} className="flex flex-wrap items-end gap-2">
        <input type="hidden" name="id" value={id} />
        {canRoles && !self ? (
          <select name="role" defaultValue={role} className="min-h-9 rounded-lg border border-line-strong bg-surface px-2 text-sm" aria-label="Rol">
            {roles.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
        ) : (
          <input type="hidden" name="role" value={role} />
        )}
        {!self ? (
          <select name="status" defaultValue={status} className="min-h-9 rounded-lg border border-line-strong bg-surface px-2 text-sm" aria-label="Durum">
            {status === "INVITED" ? <option value="INVITED">Davet edildi</option> : null}
            <option value="ACTIVE">Aktif</option>
            <option value="DISABLED">Pasif</option>
          </select>
        ) : (
          <input type="hidden" name="status" value={status} />
        )}
        {!self ? <SubmitButton variant="secondary" className="!min-h-9 !px-3">Kaydet</SubmitButton> : <span className="text-xs text-muted">(siz)</span>}
      </ActionForm>
      {!self && status !== "DISABLED" ? (
        <ActionForm action={resetLink} quiet={false}>
          <input type="hidden" name="id" value={id} />
          <button className="text-xs text-accent-ink hover:underline">{status === "INVITED" ? "Yeni davet bağlantısı" : "Şifre sıfırlama bağlantısı"}</button>
          <LinkBox />
        </ActionForm>
      ) : null}
    </div>
  );
}

export function PermissionMatrix({ roles, perms, matrix, defaults }: { roles: Opt[]; perms: { key: string; label: string; locked: boolean }[]; matrix: Record<string, boolean>; defaults: Record<string, boolean> }) {
  return (
    <ActionForm action={savePermissions}>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[820px] text-sm">
          <thead>
            <tr>
              <th className="sticky left-0 bg-surface px-3 py-2 text-left text-xs font-medium text-muted">İzin</th>
              {roles.map((r) => (
                <th key={r.value} className="px-2 py-2 text-center text-xs font-medium text-muted">
                  {r.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {perms.map((p) => (
              <tr key={p.key} className="border-t border-line">
                <td className="sticky left-0 bg-surface px-3 py-2">
                  {p.label}
                  <span className="block text-[11px] text-muted">{p.key}</span>
                </td>
                {roles.map((r) => {
                  const k = `${r.value}:${p.key}`;
                  const fixed = r.value === "SUPER_ADMIN" || p.locked;
                  const changed = !fixed && matrix[k] !== defaults[k];
                  return (
                    <td key={k} className={`px-2 py-2 text-center ${changed ? "bg-warning-soft" : ""}`}>
                      <input type="checkbox" name={k} defaultChecked={matrix[k]} disabled={fixed} className="size-4 accent-[var(--accent)]" aria-label={`${r.label}: ${p.label}`} />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-muted">Sarı hücreler varsayılandan farklıdır. Süper yönetici ve “rol/izin yönetimi” kilitlidir.</p>
        <SubmitButton>İzinleri kaydet</SubmitButton>
      </div>
    </ActionForm>
  );
}
