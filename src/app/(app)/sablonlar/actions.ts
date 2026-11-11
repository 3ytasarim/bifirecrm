"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { TemplateChannel } from "@prisma/client";
import { failure, fieldErrors, type ActionState } from "@/lib/action";
import { getActorOrNull } from "@/lib/rbac/guard";
import { saveTemplate, setTemplateActive } from "@/lib/services/templates";
import { TEMPLATE_CHANNEL_LABELS } from "@/lib/labels";

const NO_SESSION: ActionState = { ok: false, message: "Oturumunuz sona erdi. Lütfen yeniden giriş yapın." };
const uuid = z.string().regex(/^[0-9a-f-]{36}$/i);

const schema = z.object({
  name: z.string().trim().min(2, "Şablon adı yazın.").max(120),
  channel: z.enum(Object.keys(TEMPLATE_CHANNEL_LABELS) as [TemplateChannel, ...TemplateChannel[]]),
  subject: z
    .string()
    .trim()
    .max(200)
    .transform((v) => v || null),
  body: z.string().trim().min(5, "Mesaj metnini yazın.").max(5000),
});

export async function saveTemplateAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await getActorOrNull();
  if (!actor) return NO_SESSION;
  const parsed = schema.safeParse({ name: fd.get("name") ?? "", channel: fd.get("channel") ?? "", subject: fd.get("subject") ?? "", body: fd.get("body") ?? "" });
  if (!parsed.success) return { ok: false, errors: fieldErrors(parsed.error), message: "Lütfen alanları kontrol edin." };
  const rawId = String(fd.get("id") ?? "");
  if (rawId && !uuid.safeParse(rawId).success) return { ok: false, message: "Geçersiz kayıt." };
  try {
    const t = await saveTemplate(actor, rawId || null, parsed.data);
    revalidatePath("/sablonlar");
    return { ok: true, message: "Şablon kaydedildi.", redirectTo: rawId ? undefined : `/sablonlar?sablon=${t.id}` };
  } catch (e) {
    return failure(e);
  }
}

export async function toggleTemplateAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await getActorOrNull();
  if (!actor) return NO_SESSION;
  const id = uuid.safeParse(String(fd.get("id")));
  if (!id.success) return { ok: false, message: "Geçersiz kayıt." };
  try {
    const t = await setTemplateActive(actor, id.data, fd.get("active") === "1");
    revalidatePath("/sablonlar");
    return { ok: true, message: t.active ? "Şablon etkinleştirildi." : "Şablon arşivlendi." };
  } catch (e) {
    return failure(e);
  }
}
