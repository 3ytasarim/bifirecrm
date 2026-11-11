import Link from "next/link";
import type { LeadSource, LeadStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/rbac/guard";
import { LEAD_STATUS_LABELS, SOURCE_LABELS } from "@/lib/labels";
import { fmtDateTime, code } from "@/lib/format";
import { formatPhone } from "@/lib/normalize";
import { hrefWith, pageParam, PAGE_SIZE } from "@/lib/queries";
import { Badge, Card, EmptyState, PageHeader, Pagination, tableCls } from "@/components/ui/primitives";
import { buttonClass, inputClass } from "@/components/ui/styles";
import { discardLead } from "./actions";

export const metadata = { title: "Talepler" };

type SP = { durum?: string; kaynak?: string; q?: string; sayfa?: string };

export default async function LeadsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const actor = await requirePermission("leads.view");
  const sp = await searchParams;
  const status = (sp.durum && sp.durum in LEAD_STATUS_LABELS ? sp.durum : undefined) as LeadStatus | undefined;
  const source = (sp.kaynak && sp.kaynak in SOURCE_LABELS ? sp.kaynak : undefined) as LeadSource | undefined;
  const q = sp.q?.trim();
  const page = pageParam(sp.sayfa);
  const where: Prisma.LeadWhereInput = {
    ...(status ? { status } : {}),
    ...(source ? { source } : {}),
    ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { email: { contains: q.toLowerCase() } }, { phone: { contains: q.replace(/\D/g, "").slice(-10) || q } }] } : {}),
  };
  const [rows, total, counts] = await Promise.all([
    prisma.lead.findMany({
      where,
      orderBy: { receivedAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: { opportunity: { select: { id: true, number: true } }, contact: { select: { id: true, number: true } } },
    }),
    prisma.lead.count({ where }),
    prisma.lead.groupBy({ by: ["status"], _count: { _all: true } }),
  ]);
  const countOf = (s: LeadStatus) => counts.find((c) => c.status === s)?._count._all ?? 0;
  const base = "/talepler";

  return (
    <>
      <PageHeader
        title="Talepler"
        description="Web formları, reklam formları ve elle girilen başvurular. Web formu entegrasyonu Faz 2'de devreye girer."
        actions={actor.perms.has("contacts.create") ? <Link href="/talepler/yeni" className={buttonClass()}>+ Hızlı kayıt</Link> : null}
      />
      <div className="mb-4 flex flex-wrap gap-2">
        {([undefined, "RECEIVED", "CONVERTED", "DUPLICATE", "DISCARDED"] as const).map((s) => (
          <Link
            key={s ?? "all"}
            href={hrefWith(base, sp, { durum: s, sayfa: undefined })}
            className={`rounded-full border px-3 py-1.5 text-sm ${status === s ? "border-accent bg-accent-soft text-accent-ink" : "border-line bg-surface text-muted hover:text-fg"}`}
          >
            {s ? LEAD_STATUS_LABELS[s] : "Tümü"} {s ? <span className="tabular">({countOf(s)})</span> : null}
          </Link>
        ))}
      </div>
      <Card padded={false}>
        <form className="flex flex-wrap gap-2 border-b border-line p-4" role="search">
          {status ? <input type="hidden" name="durum" value={status} /> : null}
          <input name="q" defaultValue={q} placeholder="Ad, telefon, e-posta" className={`${inputClass()} max-w-xs`} aria-label="Talep ara" />
          <select name="kaynak" defaultValue={source ?? ""} className={`${inputClass()} max-w-[220px]`} aria-label="Kaynak">
            <option value="">Tüm kaynaklar</option>
            {Object.entries(SOURCE_LABELS).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
          <button className={buttonClass("secondary")}>Filtrele</button>
        </form>
        {rows.length ? (
          <div className={tableCls.wrap}>
            <table className={tableCls.table}>
              <thead>
                <tr>
                  <th className={tableCls.th}>Alındı</th>
                  <th className={tableCls.th}>Kişi</th>
                  <th className={tableCls.th}>Kaynak</th>
                  <th className={tableCls.th}>Durum</th>
                  <th className={tableCls.th}>Kayıt</th>
                  <th className={tableCls.th}></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((l) => (
                  <tr key={l.id} className={tableCls.row}>
                    <td className={`${tableCls.td} whitespace-nowrap tabular text-muted`}>{fmtDateTime(l.receivedAt)}</td>
                    <td className={tableCls.td}>
                      <span className="block font-medium">{l.name}</span>
                      <span className="block text-xs text-muted">{[formatPhone(l.phone), l.email, l.district].filter(Boolean).join(" · ")}</span>
                      {l.message ? <span className="mt-1 line-clamp-2 block max-w-md text-xs text-muted">{l.message}</span> : null}
                    </td>
                    <td className={tableCls.td}>
                      <Badge>{SOURCE_LABELS[l.source]}</Badge>
                    </td>
                    <td className={tableCls.td}>
                      <Badge tone={l.status === "RECEIVED" ? "accent" : l.status === "CONVERTED" ? "success" : "neutral"}>{LEAD_STATUS_LABELS[l.status]}</Badge>
                    </td>
                    <td className={`${tableCls.td} text-xs`}>
                      {l.opportunity ? (
                        <Link className="text-accent-ink hover:underline" href={`/firsatlar/${l.opportunity.id}`}>
                          {code.opportunity(l.opportunity.number)}
                        </Link>
                      ) : l.contact ? (
                        <Link className="text-accent-ink hover:underline" href={`/musteriler/${l.contact.id}`}>
                          {code.contact(l.contact.number)}
                        </Link>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className={`${tableCls.td} text-right`}>
                      {l.status === "RECEIVED" && actor.perms.has("leads.process") ? (
                        <div className="flex justify-end gap-1.5">
                          {actor.perms.has("contacts.create") ? (
                            <Link href={`/talepler/yeni?talep=${l.id}`} className={buttonClass("secondary", "sm")}>
                              İşle
                            </Link>
                          ) : null}
                          <form action={discardLead}>
                            <input type="hidden" name="id" value={l.id} />
                            <button className={buttonClass("ghost", "sm")}>Reddet</button>
                          </form>
                        </div>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            title={q || status || source ? "Filtreye uyan talep yok" : "Henüz talep yok"}
            description="Hızlı kayıtla girilen başvurular ve (Faz 2 sonrası) web formlarından gelen talepler burada listelenir."
          />
        )}
        <Pagination page={page} total={total} pageCount={Math.ceil(total / PAGE_SIZE)} buildHref={(p) => hrefWith(base, sp, { sayfa: p })} />
      </Card>
    </>
  );
}
