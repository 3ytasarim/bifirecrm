import "server-only";
import { createHash, randomUUID } from "node:crypto";
import net from "node:net";
import sharp from "sharp";
import type { Prisma } from "@prisma/client";
import { env } from "@/lib/env";
import { storage } from "./index";

type Detected = { mime: string; ext: string; image: boolean };

/** İçerikten tür tespiti (istemcinin bildirdiği MIME'a güvenilmez). */
export function detectType(buf: Buffer, filename: string): Detected | null {
  const ext = filename.toLowerCase().split(".").pop() ?? "";
  const head = buf.subarray(0, 12);
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return { mime: "image/jpeg", ext: "jpg", image: true };
  if (head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { mime: "image/png", ext: "png", image: true };
  if (head.toString("ascii", 0, 4) === "RIFF" && head.toString("ascii", 8, 12) === "WEBP") return { mime: "image/webp", ext: "webp", image: true };
  if (head.toString("ascii", 4, 8) === "ftyp" && /hei[cx]|mif1|heif/.test(head.toString("ascii", 8, 12))) return { mime: "image/heic", ext: "heic", image: true };
  if (head.toString("ascii", 0, 5) === "%PDF-") return { mime: "application/pdf", ext: "pdf", image: false };
  if (head.toString("ascii", 0, 4) === "AC10" && ext === "dwg") return { mime: "image/vnd.dwg", ext: "dwg", image: false };
  if (head[0] === 0x50 && head[1] === 0x4b && (ext === "docx" || ext === "xlsx")) {
    return ext === "docx"
      ? { mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", ext, image: false }
      : { mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ext, image: false };
  }
  if (ext === "dxf" && /^\s*0\s*\r?\n\s*SECTION/.test(buf.subarray(0, 64).toString("ascii"))) return { mime: "image/vnd.dxf", ext, image: false };
  return null;
}

export const ACCEPT_ATTR = ".jpg,.jpeg,.png,.webp,.heic,.pdf,.dwg,.dxf,.docx,.xlsx";

/** ClamAV (clamd INSTREAM). CLAMAV_HOST tanımlı değilse tarama yapılmaz ve kayıt NOT_SCANNED işaretlenir. */
async function clamScan(buf: Buffer): Promise<"CLEAN" | "INFECTED" | "NOT_SCANNED"> {
  const host = process.env.CLAMAV_HOST;
  if (!host) return "NOT_SCANNED";
  const port = Number(process.env.CLAMAV_PORT ?? 3310);
  return new Promise((resolve, reject) => {
    const sock = net.connect(port, host);
    let reply = "";
    sock.setTimeout(30_000, () => sock.destroy(new Error("ClamAV zaman aşımı")));
    sock.on("connect", () => {
      sock.write("zINSTREAM\0");
      for (let i = 0; i < buf.length; i += 64 * 1024) {
        const chunk = buf.subarray(i, i + 64 * 1024);
        const len = Buffer.alloc(4);
        len.writeUInt32BE(chunk.length);
        sock.write(len);
        sock.write(chunk);
      }
      sock.write(Buffer.alloc(4));
    });
    sock.on("data", (d) => (reply += d.toString()));
    sock.on("end", () => resolve(/OK/.test(reply) && !/FOUND/.test(reply) ? "CLEAN" : "INFECTED"));
    sock.on("error", reject);
  });
}

export class UploadError extends Error {}

export type StoredFile = Omit<Prisma.AttachmentUncheckedCreateInput, "kind" | "uploadedById" | "contactId" | "opportunityId" | "projectId" | "leadId">;

/**
 * Dosyayı doğrular, fotoğraflarda EXIF/konum verisini temizler (yönü uygulayarak yeniden kodlar),
 * küçük önizleme üretir ve özel depoya yazar. DB kaydı çağıran tarafta oluşturulur.
 */
export async function processAndStore(file: File): Promise<StoredFile> {
  const maxBytes = env().MAX_UPLOAD_MB * 1024 * 1024;
  if (file.size === 0) throw new UploadError("Dosya boş.");
  if (file.size > maxBytes) throw new UploadError(`Dosya en fazla ${env().MAX_UPLOAD_MB} MB olabilir.`);
  const original = Buffer.from(await file.arrayBuffer());
  const type = detectType(original, file.name);
  if (!type) throw new UploadError("Bu dosya türü desteklenmiyor (JPG, PNG, WEBP, HEIC, PDF, DWG, DXF, DOCX, XLSX).");

  const scan = await clamScan(original).catch(() => "NOT_SCANNED" as const);
  if (scan === "INFECTED") throw new UploadError("Dosyada zararlı içerik tespit edildi; yüklenmedi.");

  let body = original;
  let mime = type.mime;
  let ext = type.ext;
  let width: number | null = null;
  let height: number | null = null;
  let thumb: Buffer | null = null;
  let exifStripped = false;

  if (type.image) {
    try {
      // rotate(): EXIF yönünü piksellere uygular; sharp çıktıya metadata yazmaz (withMetadata çağrılmadı) → EXIF/GPS silinir.
      const pipeline = sharp(original, { failOn: "error", limitInputPixels: 80_000_000 }).rotate();
      if (type.mime === "image/png") {
        body = await pipeline.png().toBuffer();
      } else {
        body = await pipeline.jpeg({ quality: 88, mozjpeg: true }).toBuffer();
        mime = "image/jpeg";
        ext = "jpg";
      }
      const meta = await sharp(body).metadata();
      width = meta.width ?? null;
      height = meta.height ?? null;
      thumb = await sharp(body).resize(480, 480, { fit: "inside", withoutEnlargement: true }).webp({ quality: 72 }).toBuffer();
      exifStripped = true;
    } catch {
      throw new UploadError("Görsel işlenemedi (bozuk ya da desteklenmeyen biçim).");
    }
  }

  const now = new Date();
  const base = `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, "0")}/${randomUUID()}`;
  const storageKey = `files/${base}.${ext}`;
  const thumbnailKey = thumb ? `thumbs/${base}.webp` : null;
  const s = await storage();
  await s.put(storageKey, body, mime);
  if (thumb && thumbnailKey) await s.put(thumbnailKey, thumb, "image/webp");

  const safeName = file.name.replace(/[\\/\0\r\n]/g, "_").slice(0, 180);
  const finalName = type.image && ext !== safeName.split(".").pop()?.toLowerCase() ? safeName.replace(/\.[^.]+$/, "") + "." + ext : safeName;

  return {
    storageKey,
    thumbnailKey,
    originalName: finalName,
    mimeType: mime,
    sizeBytes: body.length,
    checksumSha256: createHash("sha256").update(body).digest("hex"),
    scanStatus: scan,
    exifStripped,
    width,
    height,
  };
}
