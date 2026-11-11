import "server-only";
import { cache } from "react";
import { prisma } from "@/lib/db";

/** Atama seçicileri için aktif kullanıcılar. */
export const activeUsers = cache(async () =>
  prisma.user.findMany({ where: { status: "ACTIVE" }, select: { id: true, name: true, role: true }, orderBy: { name: "asc" } }),
);

export const userOptions = async () => (await activeUsers()).map((u) => ({ value: u.id, label: u.name }));

export function pageParam(v: string | undefined) {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : 1;
}

export const PAGE_SIZE = 25;

/** URL arama parametrelerini koruyarak yeni href üretir (filtreler URL'de saklanır). */
export function hrefWith(base: string, params: Record<string, string | undefined>, patch: Record<string, string | number | undefined>) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...params, ...patch })) {
    if (v !== undefined && v !== "" && v !== null) sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `${base}?${s}` : base;
}
