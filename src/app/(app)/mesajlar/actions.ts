"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { failure, type ActionState } from "@/lib/action";
import { getActorOrNull } from "@/lib/rbac/guard";
import { conversationScope, contactScope } from "@/lib/rbac/scope";
import { assignConversation, sendWhatsappTemplate } from "@/lib/services/channels";

const NO_SESSION: ActionState = { ok: false, message: "Oturumunuz sona erdi. Lütfen yeniden giriş yapın." };
const uuid = z.string().regex(/^[0-9a-f-]{36}$/i);

export async function sendTemplateAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await getActorOrNull();
  if (!actor) return NO_SESSION;
  const conversationId = String(fd.get("conversationId") ?? "");
  const contactId = String(fd.get("contactId") ?? "");
  const templateId = String(fd.get("templateId") ?? "");
  if (!uuid.safeParse(templateId).success) return { ok: false, errors: { templateId: "Şablon seçin." }, message: "Lütfen alanları kontrol edin." };
  const params = fd.getAll("param").map(String);
  try {
    // Kullanıcı yalnız erişebildiği yazışmaya / müşteriye gönderebilir.
    if (conversationId) {
      if (!uuid.safeParse(conversationId).success || !(await prisma.conversation.findFirst({ where: { id: conversationId, ...conversationScope(actor) }, select: { id: true } }))) return { ok: false, message: "Yazışma bulunamadı ya da erişiminiz yok." };
    } else if (!uuid.safeParse(contactId).success || !(await prisma.contact.findFirst({ where: { id: contactId, ...contactScope(actor) }, select: { id: true } }))) {
      return { ok: false, message: "Müşteri bulunamadı ya da erişiminiz yok." };
    }
    const m = await sendWhatsappTemplate(actor, { conversationId: conversationId || null, contactId: contactId || null, templateId, params });
    revalidatePath(`/mesajlar/${m.conversationId}`);
    return { ok: true, message: "Mesaj gönderim sırasına alındı; durum birkaç saniye içinde güncellenir.", redirectTo: conversationId ? undefined : `/mesajlar/${m.conversationId}` };
  } catch (e) {
    return failure(e);
  }
}

export async function assignConversationAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await getActorOrNull();
  if (!actor) return NO_SESSION;
  const id = String(fd.get("id") ?? "");
  const userId = String(fd.get("userId") ?? "");
  if (!uuid.safeParse(id).success || (userId && !uuid.safeParse(userId).success)) return { ok: false, message: "Geçersiz kayıt." };
  try {
    if (!(await prisma.conversation.findFirst({ where: { id, ...conversationScope(actor) }, select: { id: true } }))) return { ok: false, message: "Yazışma bulunamadı ya da erişiminiz yok." };
    await assignConversation(actor, id, userId || null);
    revalidatePath(`/mesajlar/${id}`);
    return { ok: true, message: "Atama kaydedildi." };
  } catch (e) {
    return failure(e);
  }
}
