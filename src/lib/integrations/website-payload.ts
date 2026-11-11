import { z } from "zod";
import type { LeadSource, ScanStatus } from "@prisma/client";

/**
 * Site → CRM web formu yükü (sürüm 1). Site kaynağı: `ContactRequest` satırı (+ özel tasarım fotoğrafı).
 * submissionId = sitedeki ContactRequest.id → leads (source, sourceSubmissionId) tekil olduğu için idempotent.
 */
const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => v || null);

export const MAX_WEBSITE_ATTACHMENTS = 3;
export const MAX_WEBSITE_ATTACHMENT_BYTES = 10 * 1024 * 1024;
/** Ham gövde sınırı: 3 × 10 MB base64 (~%34 şişme) + alanlar. */
export const MAX_WEBSITE_BODY_BYTES = 42 * 1024 * 1024;

export const websitePayloadSchema = z.object({
  version: z.literal(1),
  submissionId: z.string().trim().min(8).max(64).regex(/^[A-Za-z0-9_-]+$/),
  formType: z.enum(["CONTACT", "QUOTE", "SHOWROOM", "DESIGN"]),
  submittedAt: z.iso.datetime({ offset: true }),
  name: z.string().trim().min(1).max(160),
  phone: text(40),
  email: text(200),
  message: text(5000),
  district: text(80),
  topic: text(200),
  projectStage: text(120),
  timeline: text(120),
  selection: text(1000),
  productName: text(200),
  categoryName: text(200),
  sourcePath: text(300),
  consent: z.object({
    kvkkAcknowledged: z.boolean(),
    consentAt: z.iso.datetime({ offset: true }).nullish(),
    noticeVersion: text(40),
  }),
  attachments: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(200),
        mimeType: z.string().trim().max(100),
        dataBase64: z.string().max(Math.ceil((MAX_WEBSITE_ATTACHMENT_BYTES * 4) / 3) + 8),
      }),
    )
    .max(MAX_WEBSITE_ATTACHMENTS)
    .default([]),
});

export type WebsitePayload = z.infer<typeof websitePayloadSchema>;

/** Olay kaydında saklanan hal: dosyalar depoya yazılmış, base64 içerik çıkarılmış. */
export type StoredWebsitePayload = Omit<WebsitePayload, "attachments"> & {
  files: {
    storageKey: string;
    thumbnailKey: string | null;
    originalName: string;
    mimeType: string;
    sizeBytes: number;
    checksumSha256: string;
    scanStatus: ScanStatus;
    exifStripped: boolean;
    width: number | null;
    height: number | null;
  }[];
};

export const WEBSITE_SOURCE: Record<WebsitePayload["formType"], LeadSource> = {
  CONTACT: "WEBSITE_CONTACT",
  QUOTE: "WEBSITE_QUOTE",
  SHOWROOM: "WEBSITE_SHOWROOM",
  DESIGN: "WEBSITE_DESIGN",
};
