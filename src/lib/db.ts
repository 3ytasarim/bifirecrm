import "server-only";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient | undefined };

function createPrismaClient() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL tanımlı değil");
  // sslmode=require → verify-full: sertifika doğrulamalı bağlantı (pg'nin gelecek sürüm anlam değişikliğinden bağımsız).
  const connectionString = url.replace(/sslmode=require\b/, "sslmode=verify-full");
  const adapter = new PrismaPg({ connectionString, max: Number(process.env.DB_POOL_MAX ?? 10) });
  return new PrismaClient({
    adapter,
    // Neon uykudan uyanırken varsayılan 2 sn bekleme yetmiyor (P2028).
    transactionOptions: { maxWait: 10_000, timeout: 20_000 },
  });
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
