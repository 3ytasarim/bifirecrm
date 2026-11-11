import "server-only";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { env } from "@/lib/env";
import { hmac, safeEqual } from "@/lib/crypto";

/**
 * Özel dosya deposu. Dosyalar asla public klasöre/URL'ye yazılmaz.
 *  - local: sunucuda web kökü dışındaki dizin (geliştirme / tek sunucu başlangıcı).
 *  - s3: S3 uyumlu PRIVATE bucket (Hetzner Object Storage / Cloudflare R2). İndirme süreli imzalı URL ile.
 * Her iki sürücüde de indirme önce /api/files/[id] üzerinden yetki kontrolünden geçer.
 */
export interface StorageDriver {
  name: "local" | "s3";
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
  /** S3: doğrudan süreli imzalı URL. local: null (uygulama içinden akıtılır). */
  presignedGetUrl(key: string, filename: string, ttlSec: number): Promise<string | null>;
}

function safeLocalPath(root: string, key: string) {
  if (!/^[a-zA-Z0-9/_.-]+$/.test(key) || key.includes("..")) throw new Error("Geçersiz depolama anahtarı");
  const full = path.resolve(root, key);
  if (!full.startsWith(path.resolve(root) + path.sep)) throw new Error("Geçersiz depolama yolu");
  return full;
}

const localDriver = (): StorageDriver => {
  const root = path.resolve(/*turbopackIgnore: true*/ process.cwd(), env().LOCAL_STORAGE_DIR);
  return {
    name: "local",
    async put(key, body) {
      const full = safeLocalPath(root, key);
      await mkdir(path.dirname(full), { recursive: true });
      await writeFile(full, body, { flag: "wx" });
    },
    async get(key) {
      return readFile(safeLocalPath(root, key));
    },
    async delete(key) {
      await rm(safeLocalPath(root, key), { force: true });
    },
    async presignedGetUrl() {
      return null;
    },
  };
};

const s3Driver = async (): Promise<StorageDriver> => {
  const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } = await import("@aws-sdk/client-s3");
  const { getSignedUrl } = await import("@aws-sdk/s3-request-presigner");
  const e = env();
  const client = new S3Client({
    endpoint: e.S3_ENDPOINT,
    region: e.S3_REGION ?? "auto",
    forcePathStyle: true,
    credentials: { accessKeyId: e.S3_ACCESS_KEY_ID!, secretAccessKey: e.S3_SECRET_ACCESS_KEY! },
  });
  const Bucket = e.S3_BUCKET!;
  return {
    name: "s3",
    async put(key, body, contentType) {
      await client.send(new PutObjectCommand({ Bucket, Key: key, Body: body, ContentType: contentType }));
    },
    async get(key) {
      const res = await client.send(new GetObjectCommand({ Bucket, Key: key }));
      return Buffer.from(await res.Body!.transformToByteArray());
    },
    async delete(key) {
      await client.send(new DeleteObjectCommand({ Bucket, Key: key }));
    },
    async presignedGetUrl(key, filename, ttlSec) {
      return getSignedUrl(
        client,
        new GetObjectCommand({ Bucket, Key: key, ResponseContentDisposition: `attachment; filename*=UTF-8''${encodeURIComponent(filename)}` }),
        { expiresIn: ttlSec },
      );
    },
  };
};

let driver: Promise<StorageDriver> | null = null;
export function storage(): Promise<StorageDriver> {
  driver ??= env().STORAGE_DRIVER === "s3" ? s3Driver() : Promise.resolve(localDriver());
  return driver;
}

/**
 * Kullanıcıya bağlı, süreli dosya bağlantısı imzası. Bağlantı başka kullanıcıda çalışmaz:
 * imza userId içerir ve uç nokta ayrıca oturumdaki kullanıcıyı + kayıt yetkisini doğrular.
 */
export function signFileToken(attachmentId: string, userId: string, variant: "file" | "thumb", ttlSec = 300) {
  const exp = Math.floor(Date.now() / 1000) + ttlSec;
  const sig = hmac(env().FILE_URL_SECRET, `${attachmentId}.${userId}.${variant}.${exp}`);
  return { exp, sig };
}

export function verifyFileToken(attachmentId: string, userId: string, variant: "file" | "thumb", exp: number, sig: string) {
  if (!Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) return false;
  return safeEqual(sig, hmac(env().FILE_URL_SECRET, `${attachmentId}.${userId}.${variant}.${exp}`));
}
