import "server-only";
import { hash, verify } from "@node-rs/argon2";
import { z } from "zod";

// OWASP önerisine yakın argon2id parametreleri.
const OPTS = { memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

export const passwordSchema = z
  .string()
  .min(12, "Şifre en az 12 karakter olmalı.")
  .max(200, "Şifre çok uzun.")
  .refine((v) => /[a-zçğıöşü]/.test(v) && /[A-ZÇĞİÖŞÜ]/.test(v) && /\d/.test(v), "Şifre büyük harf, küçük harf ve rakam içermeli.");

export function hashPassword(plain: string) {
  return hash(plain, OPTS);
}

export async function verifyPassword(hashed: string, plain: string) {
  try {
    return await verify(hashed, plain);
  } catch {
    return false;
  }
}

/** Kullanıcı yokken de aynı süreyi harcamak için (zamanlama ile e-posta keşfini zorlaştırır). */
let dummyHash: string | null = null;
export async function burnPasswordTime(plain: string) {
  dummyHash ??= await hash("bifire-dummy-password-for-timing", OPTS);
  await verifyPassword(dummyHash, plain);
}
