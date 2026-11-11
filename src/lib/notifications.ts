import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

type Tx = Prisma.TransactionClient | typeof prisma;

/** Çalışana iç bildirim (müşteriye mesaj değildir). dedupeKey aynı olayın tekrar bildirilmesini engeller. */
export async function notify(
  input: { userId: string; type: string; title: string; body?: string; link?: string; dedupeKey?: string },
  tx: Tx = prisma,
) {
  if (input.dedupeKey) {
    await tx.internalNotification.upsert({
      where: { userId_dedupeKey: { userId: input.userId, dedupeKey: input.dedupeKey } },
      create: input,
      update: {},
    });
    return;
  }
  await tx.internalNotification.create({ data: input });
}

export async function unreadCount(userId: string) {
  return prisma.internalNotification.count({ where: { userId, readAt: null } });
}
