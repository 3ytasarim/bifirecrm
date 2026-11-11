import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requestMeta } from "@/lib/auth/session";

type Tx = Prisma.TransactionClient | typeof prisma;

export type AuditInput = {
  actorId: string | null;
  action: string;
  entityType?: string;
  entityId?: string;
  summary?: string;
  before?: Prisma.InputJsonValue;
  after?: Prisma.InputJsonValue;
};

/** Denetim kaydı. Sır/şifre alanları asla before/after içine konmaz (redact()). */
export async function audit(input: AuditInput, tx: Tx = prisma) {
  let meta: { ipHash: string | null; userAgent: string | null } = { ipHash: null, userAgent: null };
  try {
    meta = await requestMeta();
  } catch {
    // İstek bağlamı dışında (worker / betik) çağrıldı.
  }
  await tx.auditLog.create({ data: { ...input, ipHash: meta.ipHash, userAgent: meta.userAgent } });
}

const SECRET_KEYS = /pass|secret|token|hash|mfa/i;

export function redact<T extends Record<string, unknown>>(obj: T): Prisma.InputJsonValue {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (SECRET_KEYS.test(k)) continue;
    out[k] = v instanceof Date ? v.toISOString() : typeof v === "bigint" ? v.toString() : v && typeof v === "object" && "toFixed" in v ? String(v) : v;
  }
  return out as Prisma.InputJsonValue;
}

/** Yalnız değişen alanları before/after olarak döndürür. */
export function diff(before: Record<string, unknown>, after: Record<string, unknown>) {
  const b: Record<string, unknown> = {};
  const a: Record<string, unknown> = {};
  for (const key of Object.keys(after)) {
    const bv = before[key];
    const av = after[key];
    const norm = (v: unknown) => (v instanceof Date ? v.toISOString() : v === undefined ? null : v && typeof v === "object" && "toFixed" in v ? String(v) : JSON.stringify(v));
    if (norm(bv) !== norm(av)) {
      b[key] = bv;
      a[key] = av;
    }
  }
  return { before: redact(b), after: redact(a), changed: Object.keys(a) };
}
