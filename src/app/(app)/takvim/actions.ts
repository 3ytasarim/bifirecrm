"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { failure, fieldErrors, type ActionState } from "@/lib/action";
import { istanbulLocalToDate } from "@/lib/format";
import { getActorOrNull } from "@/lib/rbac/guard";
import { createAppointment, setAppointmentStatus, updateAppointment, type AppointmentInput } from "@/lib/services/appointments";
import { APPOINTMENT_STATUS_LABELS, APPOINTMENT_TYPE_LABELS } from "@/lib/labels";
import type { AppointmentStatus, AppointmentType } from "@prisma/client";

const NO_SESSION: ActionState = { ok: false, message: "Oturumunuz sona erdi. Lütfen yeniden giriş yapın." };
const uuid = z.string().regex(/^[0-9a-f-]{36}$/i, "Geçersiz kayıt.");
const optUuid = z
  .string()
  .transform((v) => v || null)
  .pipe(uuid.nullable());
const optText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => v || null);
const localDate = z.string().transform((v, ctx) => {
  if (!v) return null;
  const d = istanbulLocalToDate(v);
  if (!d) {
    ctx.addIssue({ code: "custom", message: "Geçersiz tarih/saat." });
    return z.NEVER;
  }
  return d;
});

const schema = z.object({
  type: z.enum(Object.keys(APPOINTMENT_TYPE_LABELS) as [AppointmentType, ...AppointmentType[]], { message: "Randevu türü seçin." }),
  status: z.enum(Object.keys(APPOINTMENT_STATUS_LABELS) as [AppointmentStatus, ...AppointmentStatus[]]),
  contactId: uuid,
  opportunityId: optUuid,
  projectId: optUuid,
  startAt: localDate,
  endAt: localDate,
  location: optText(300),
  assignedUserId: optUuid,
  requestedNote: optText(500),
  notes: optText(4000),
  allowOverlap: z.boolean(),
});

function parse(fd: FormData) {
  const keys = ["type", "status", "contactId", "opportunityId", "projectId", "startAt", "endAt", "location", "assignedUserId", "requestedNote", "notes"] as const;
  return schema.safeParse({ ...Object.fromEntries(keys.map((k) => [k, String(fd.get(k) ?? "")])), allowOverlap: fd.get("allowOverlap") === "on" });
}

export async function saveAppointmentAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await getActorOrNull();
  if (!actor) return NO_SESSION;
  const parsed = parse(fd);
  if (!parsed.success) return { ok: false, errors: fieldErrors(parsed.error), message: "Lütfen alanları kontrol edin." };
  const input: AppointmentInput = parsed.data;
  const id = String(fd.get("id") ?? "");
  try {
    if (id) {
      if (!uuid.safeParse(id).success) return { ok: false, message: "Geçersiz kayıt." };
      await updateAppointment(actor, id, input);
      revalidatePath(`/takvim/${id}`);
      revalidatePath("/takvim");
      return { ok: true, message: "Randevu güncellendi." };
    }
    const a = await createAppointment(actor, input);
    revalidatePath("/takvim");
    return { ok: true, message: "Randevu oluşturuldu.", redirectTo: `/takvim/${a.id}` };
  } catch (e) {
    return failure(e);
  }
}

export async function appointmentStatusAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await getActorOrNull();
  if (!actor) return NO_SESSION;
  const id = uuid.safeParse(String(fd.get("id")));
  const status = String(fd.get("status"));
  if (!id.success || !(status in APPOINTMENT_STATUS_LABELS)) return { ok: false, message: "Geçersiz istek." };
  try {
    await setAppointmentStatus(actor, id.data, status as AppointmentStatus);
    revalidatePath(`/takvim/${id.data}`);
    revalidatePath("/takvim");
    return { ok: true, message: `Durum: ${APPOINTMENT_STATUS_LABELS[status as AppointmentStatus]}` };
  } catch (e) {
    return failure(e);
  }
}
