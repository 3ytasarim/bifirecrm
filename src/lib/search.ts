import type { Prisma } from "@prisma/client";
import { normalizeEmail, normalizePhone } from "@/lib/normalize";

/** Serbest metinden müşteri filtresi: ad (trgm), telefon (E.164 / son haneler), e-posta, M-no. */
export function contactSearchWhere(q: string | undefined): Prisma.ContactWhereInput {
  const term = q?.trim();
  if (!term) return {};
  const num = /^m-?0*(\d+)$/i.exec(term);
  if (num) return { number: Number(num[1]) };
  const or: Prisma.ContactWhereInput[] = [{ fullName: { contains: term, mode: "insensitive" } }];
  const phone = normalizePhone(term);
  if (phone) or.push({ primaryPhone: phone }, { channels: { some: { normalized: phone } } });
  const digits = term.replace(/\D/g, "");
  if (digits.length >= 4 && digits.length === term.replace(/[\s()+-]/g, "").length) or.push({ primaryPhone: { endsWith: digits.slice(-10) } });
  const email = normalizeEmail(term);
  if (email) or.push({ primaryEmail: email }, { channels: { some: { normalized: email } } });
  else if (term.includes("@")) or.push({ primaryEmail: { contains: term.toLowerCase() } });
  or.push({ organization: { name: { contains: term, mode: "insensitive" } } });
  return { OR: or };
}
