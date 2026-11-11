"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ActivityType, AttachmentKind, TaskPriority, TaskStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { audit } from "@/lib/audit";
import { failure, fieldErrors, formObject, zOptional, zUuidOpt, type ActionState } from "@/lib/action";
import { istanbulLocalToDate } from "@/lib/format";
import { LOGGABLE_ACTIVITIES } from "@/lib/labels";
import { assertCan, ForbiddenError, getActorOrNull } from "@/lib/rbac/guard";
import { resolveRecord, type RecordRef } from "@/lib/services/records";
import { createTask, deleteTask, setTaskStatus, updateTask } from "@/lib/services/tasks";
import { processAndStore, UploadError } from "@/lib/storage/files";
import { storage } from "@/lib/storage";
import { opportunityScope } from "@/lib/rbac/scope";

const NO_SESSION: ActionState = { ok: false, message: "Oturumunuz sona erdi. Lütfen yeniden giriş yapın." };

function refFrom(fd: FormData): RecordRef {
  const kind = String(fd.get("recordKind"));
  const id = String(fd.get("recordId"));
  if (kind !== "contact" && kind !== "opportunity" && kind !== "project") throw new ForbiddenError("Geçersiz kayıt.");
  return { kind, id };
}

// ── Not ──
export async function addNote(_: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await getActorOrNull();
  if (!actor) return NO_SESSION;
  const body = String(fd.get("body") ?? "").trim();
  if (!body) return { ok: false, errors: { body: "Not boş olamaz." } };
  if (body.length > 10_000) return { ok: false, errors: { body: "Not en fazla 10.000 karakter olabilir." } };
  try {
    if (!actor.perms.has("notes.write")) throw new ForbiddenError();
    const r = await resolveRecord(actor, refFrom(fd));
    await prisma.note.create({ data: { body, pinned: fd.get("pinned") === "on", authorId: actor.id, contactId: r.contactId, opportunityId: r.opportunityId, projectId: r.projectId } });
    revalidatePath(r.path);
    return { ok: true, message: "Not eklendi." };
  } catch (e) {
    return failure(e);
  }
}

export async function toggleNotePin(fd: FormData) {
  const actor = await getActorOrNull();
  if (!actor) return;
  const note = await prisma.note.findUnique({ where: { id: String(fd.get("id")) } });
  if (!note || note.deletedAt) return;
  const ref: RecordRef = note.projectId ? { kind: "project", id: note.projectId } : note.opportunityId ? { kind: "opportunity", id: note.opportunityId } : { kind: "contact", id: note.contactId! };
  const r = await resolveRecord(actor, ref);
  if (!actor.perms.has("notes.write")) return;
  await prisma.note.update({ where: { id: note.id }, data: { pinned: !note.pinned } });
  revalidatePath(r.path);
}

export async function deleteNote(fd: FormData) {
  const actor = await getActorOrNull();
  if (!actor) return;
  const note = await prisma.note.findUnique({ where: { id: String(fd.get("id")) } });
  if (!note || note.deletedAt) return;
  // Not yalnız yazarı ya da yönetici tarafından silinir.
  if (note.authorId !== actor.id && !actor.perms.has("contacts.view_all")) return;
  const ref: RecordRef = note.projectId ? { kind: "project", id: note.projectId } : note.opportunityId ? { kind: "opportunity", id: note.opportunityId } : { kind: "contact", id: note.contactId! };
  const r = await resolveRecord(actor, ref);
  await prisma.note.update({ where: { id: note.id }, data: { deletedAt: new Date() } });
  await audit({ actorId: actor.id, action: "delete", entityType: "note", entityId: note.id, summary: note.body.slice(0, 120) });
  revalidatePath(r.path);
}

// ── Görüşme / aktivite ──
const activitySchema = z.object({
  type: z.enum(ActivityType).refine((t) => LOGGABLE_ACTIVITIES.includes(t), "Geçersiz tür."),
  subject: zOptional(200),
  body: zOptional(10_000),
  occurredAt: z
    .string()
    .optional()
    .transform((v) => (v ? istanbulLocalToDate(v) : new Date())),
  durationMin: z
    .string()
    .optional()
    .transform((v) => (v ? Number(v) : null))
    .refine((v) => v === null || (Number.isInteger(v) && v >= 0 && v <= 1440), "0–1440 dk arası."),
});

export async function logActivity(_: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await getActorOrNull();
  if (!actor) return NO_SESSION;
  const parsed = activitySchema.safeParse(formObject(fd));
  if (!parsed.success) return { ok: false, errors: fieldErrors(parsed.error) };
  if (!parsed.data.occurredAt) return { ok: false, errors: { occurredAt: "Geçerli bir tarih seçin." } };
  try {
    if (!actor.perms.has("notes.write")) throw new ForbiddenError();
    const r = await resolveRecord(actor, refFrom(fd));
    await prisma.activity.create({ data: { ...parsed.data, occurredAt: parsed.data.occurredAt, actorId: actor.id, contactId: r.contactId, opportunityId: r.opportunityId, projectId: r.projectId } });
    if (r.opportunityId && ["CALL", "MEETING", "SHOWROOM_VISIT", "SITE_VISIT", "WHATSAPP", "INSTAGRAM", "EMAIL"].includes(parsed.data.type)) {
      const o = await prisma.opportunity.findFirst({ where: { id: r.opportunityId, ...opportunityScope(actor) }, select: { lastContactAt: true } });
      if (o && (!o.lastContactAt || o.lastContactAt < parsed.data.occurredAt)) {
        await prisma.opportunity.update({ where: { id: r.opportunityId }, data: { lastContactAt: parsed.data.occurredAt } });
      }
    }
    revalidatePath(r.path);
    return { ok: true, message: "Görüşme kaydedildi." };
  } catch (e) {
    return failure(e);
  }
}

// ── Görev ──
const taskSchema = z.object({
  title: z.string().trim().min(2, "Görev başlığı yazın.").max(200),
  description: zOptional(4000),
  priority: z.enum(TaskPriority),
  dueAt: z
    .string()
    .optional()
    .transform((v) => (v ? istanbulLocalToDate(v) : null)),
  remindAt: z
    .string()
    .optional()
    .transform((v) => (v ? istanbulLocalToDate(v) : null)),
  repeatMinutes: z
    .string()
    .optional()
    .transform((v) => (v ? Number(v) : null))
    .refine((v) => v === null || [15, 30, 60, 120, 240, 1440].includes(v), "Geçersiz tekrar aralığı."),
  assigneeId: zUuidOpt,
  contactId: zUuidOpt,
  opportunityId: zUuidOpt,
  projectId: zUuidOpt,
  status: z.enum(TaskStatus).optional(),
});

export async function saveTask(_: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await getActorOrNull();
  if (!actor) return NO_SESSION;
  const parsed = taskSchema.safeParse(formObject(fd));
  if (!parsed.success) return { ok: false, errors: fieldErrors(parsed.error), message: "Lütfen işaretli alanları düzeltin." };
  try {
    assertCan(actor, "tasks.manage");
    const id = String(fd.get("id") ?? "");
    const recordKind = fd.get("recordKind");
    let links = { contactId: parsed.data.contactId, opportunityId: parsed.data.opportunityId, projectId: parsed.data.projectId };
    let path = "/gorevler";
    if (recordKind) {
      const r = await resolveRecord(actor, refFrom(fd));
      links = { contactId: r.contactId, opportunityId: r.opportunityId, projectId: r.projectId };
      path = r.path;
    }
    if (id) {
      await updateTask(actor, id, { ...parsed.data, ...links, status: parsed.data.status ?? "OPEN" });
    } else {
      await createTask(actor, { ...parsed.data, ...links });
    }
    revalidatePath(path);
    revalidatePath("/gorevler");
    return { ok: true, message: id ? "Görev güncellendi." : "Görev oluşturuldu." };
  } catch (e) {
    return failure(e);
  }
}

export async function changeTaskStatus(fd: FormData) {
  const actor = await getActorOrNull();
  if (!actor) return;
  const status = String(fd.get("status"));
  if (!(status in TaskStatus)) return;
  await setTaskStatus(actor, String(fd.get("id")), status as TaskStatus);
  revalidatePath(String(fd.get("path") || "/gorevler"));
  revalidatePath("/gorevler");
}

export async function removeTask(fd: FormData) {
  const actor = await getActorOrNull();
  if (!actor) return;
  await deleteTask(actor, String(fd.get("id")));
  revalidatePath(String(fd.get("path") || "/gorevler"));
}

// ── Dosya ──
export async function uploadFiles(_: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await getActorOrNull();
  if (!actor) return NO_SESSION;
  try {
    assertCan(actor, "files.upload");
    const r = await resolveRecord(actor, refFrom(fd));
    const kind = String(fd.get("kind") ?? "OTHER");
    if (!(kind in AttachmentKind)) return { ok: false, message: "Geçersiz dosya türü." };
    const files = fd.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
    if (!files.length) return { ok: false, errors: { files: "Dosya seçin." } };
    if (files.length > 10) return { ok: false, errors: { files: "Tek seferde en fazla 10 dosya." } };
    const done: string[] = [];
    const failed: string[] = [];
    for (const file of files) {
      try {
        const stored = await processAndStore(file);
        const a = await prisma.attachment.create({
          data: { ...stored, kind: kind as AttachmentKind, uploadedById: actor.id, contactId: r.contactId, opportunityId: r.opportunityId, projectId: r.projectId },
        });
        await prisma.activity.create({ data: { type: "FILE", subject: `Dosya yüklendi: ${a.originalName}`, actorId: actor.id, contactId: r.contactId, opportunityId: r.opportunityId, projectId: r.projectId, metadata: { attachmentId: a.id } } });
        await audit({ actorId: actor.id, action: "file_upload", entityType: "attachment", entityId: a.id, summary: a.originalName, after: { size: a.sizeBytes, mime: a.mimeType, sha256: a.checksumSha256, exifStripped: a.exifStripped } });
        done.push(a.originalName);
      } catch (e) {
        failed.push(`${file.name}: ${e instanceof UploadError ? e.message : "yüklenemedi"}`);
        if (!(e instanceof UploadError)) console.error("[upload]", e);
      }
    }
    revalidatePath(r.path);
    if (failed.length) return { ok: done.length > 0, message: `${done.length} dosya yüklendi. Yüklenemeyen: ${failed.join("; ")}` };
    return { ok: true, message: `${done.length} dosya güvenli depoya yüklendi.` };
  } catch (e) {
    return failure(e);
  }
}

export async function deleteFile(fd: FormData) {
  const actor = await getActorOrNull();
  if (!actor) return;
  assertCan(actor, "files.delete");
  const a = await prisma.attachment.findUnique({ where: { id: String(fd.get("id")) } });
  if (!a || a.deletedAt) return;
  const ref: RecordRef = a.projectId ? { kind: "project", id: a.projectId } : a.opportunityId ? { kind: "opportunity", id: a.opportunityId } : { kind: "contact", id: a.contactId! };
  const r = await resolveRecord(actor, ref);
  // Önce DB'de yumuşak sil (geçmiş korunur), sonra nesneyi depodan kaldır.
  await prisma.attachment.update({ where: { id: a.id }, data: { deletedAt: new Date() } });
  const s = await storage();
  await s.delete(a.storageKey).catch((e) => console.error("[storage.delete]", e));
  if (a.thumbnailKey) await s.delete(a.thumbnailKey).catch(() => undefined);
  await audit({ actorId: actor.id, action: "file_delete", entityType: "attachment", entityId: a.id, summary: a.originalName });
  revalidatePath(r.path);
}
