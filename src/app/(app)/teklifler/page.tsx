import Link from "next/link";
import { redirect } from "next/navigation";
import type { Prisma, QuoteStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireActor } from "@/lib/rbac/guard";
import { quoteScope } from "@/lib/rbac/scope";
import { contactSearchWhere } from "@/lib/search";
import { QUOTE_STATUS_LABELS, QUOTE_STATUS_TONE } from "@/lib/labels";
import { code, fmtDate } from "@/lib/format";
import { formatAmount } from "@/lib/quotes/calc";
import { hrefWith, pageParam, PAGE_SIZE } from "@/lib/queries";
import { Badge, Card, EmptyState, PageHeader, Pagination, tableCls } from "@/components/ui/primitives";
import { buttonClass, inputClass } from "@/components/ui/styles";

export const metadata = { title: "Teklifler" };

type SP = { q?: string; durum?: string; sayfa?: string };

export default async function QuotesPage({ searchParams }: { searchParams: Promise<SP> }) {
  const actor = await requireActor();
  if (!actor.perms.has("quotes.view")) redirect("/yetkisiz");
  const sp = await searchParams;
  const status = sp.durum && sp.durum in QUOTE_STATUS_LABELS ? (sp.durum as QuoteStatus) : undefined;
  const q = sp.q?.trim();
  const where: Prisma.QuoteWhereInput = {
    AND: [
      quoteScope(actor),
      status ? { status } : {},
      q ? { OR: [{ contact: contactSearchWhere(q) }, { opportunity: { title: { contains: q, mode: "insensitive" } } }, ...(/^t-?0*\d+$/i.test(q) ? [{ number: Number(q.replace(/\D/g, "")) }] : [])] } : {},
    ],
  };
  const page = pageParam(sp.sayfa);
  const [rows, total, counts] = await Promise.all([
    prisma.quote.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: { id: true, number: true, version: true, status: true, currency: true, grandTotal: true, validUntil: true, createdAt: true, sentAt: true, contact: { select: { fullName: true } }, opportunity: { select: { title: true } } },
    }),
    prisma.quote.count({ where }),
    prisma.quote.groupBy({ by: ["status"], where: quoteScope(actor), _count: { _all: true } }),
  ]);
  const countOf = (s: QuoteStatus) => counts.find((c) => c.status === s)?._count._all ?? 0;
  const base = "/teklifler";
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  return (
    <>
      <PageHeader title="Teklifler" description="Fırsatlardan hazırlanan teklifler. Onaylanmayan teklif müşteriye gönderilemez." />
      <form className="mb-4 grid gap-2 rounded-xl border border-line bg-surface p-3 shadow-card sm:grid-cols-[2fr_1fr_auto]" role="search">
        <input name="q" defaultValue={sp.q} placeholder="Müşteri, fırsat, T-no" className={inputClass()} aria-label="Teklif ara" />
        <select name="durum" defaultValue={status ?? ""} className={inputClass()} aria-label="Durum">
          <option value="">Tüm durumlar</option>
          {Object.entries(QUOTE_STATUS_LABELS).map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
        <button className={buttonClass("secondary")}>Filtrele</button>
      </form>
      <div className="mb-3 flex flex-wrap gap-1.5">
        {(Object.keys(QUOTE_STATUS_LABELS) as QuoteStatus[]).map((s) => (
          <Link key={s} href={hrefWith(base, sp, { durum: status === s ? undefined : s, sayfa: undefined })} className={`rounded-full border px-2.5 py-1 text-xs ${status === s ? "border-accent bg-accent-soft text-accent-ink" : "border-line bg-surface text-muted hover:text-fg"}`}>
            {QUOTE_STATUS_LABELS[s]} <span className="tabular">({countOf(s)})</span>
          </Link>
        ))}
      </div>
      <Card padded={false}>
        {rows.length ? (
          <div className={tableCls.wrap}>
            <table className={tableCls.table}>
              <thead>
                <tr>
                  <th className={tableCls.th}>No</th>
                  <th className={tableCls.th}>Müşteri / Fırsat</th>
                  <th className={tableCls.th}>Durum</th>
                  <th className={`${tableCls.th} text-right`}>Genel toplam</th>
                  <th className={tableCls.th}>Geçerlilik</th>
                  <th className={tableCls.th}>Oluşturma</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const expired = r.validUntil && r.validUntil < today && (r.status === "SENT" || r.status === "APPROVED");
                  return (
                    <tr key={r.id} className={tableCls.row}>
                      <td className={`${tableCls.td} tabular text-xs text-muted`}>
                        {code.quote(r.number)}
                        {r.version > 1 ? <span className="ml-1">· s{r.version}</span> : null}
                      </td>
                      <td className={tableCls.td}>
                        <Link href={`/teklifler/${r.id}`} className="font-medium hover:text-accent-ink hover:underline">
                          {r.contact.fullName}
                        </Link>
                        {r.opportunity ? <span className="block text-xs text-muted">{r.opportunity.title}</span> : null}
                      </td>
                      <td className={tableCls.td}>
                        <Badge tone={QUOTE_STATUS_TONE[r.status]}>{QUOTE_STATUS_LABELS[r.status]}</Badge>
                      </td>
                      <td className={`${tableCls.td} text-right font-medium tabular`}>{formatAmount(r.grandTotal.toString(), r.currency)}</td>
                      <td className={`${tableCls.td} text-xs ${expired ? "font-medium text-danger" : "text-muted"}`}>
                        {fmtDate(r.validUntil)}
                        {expired ? " · süresi doldu" : ""}
                      </td>
                      <td className={`${tableCls.td} text-xs text-muted`}>{fmtDate(r.createdAt)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState title={q || status ? "Filtreye uyan teklif yok" : "Henüz teklif yok"} description={q || status ? undefined : "Bir satış fırsatını açıp “Teklifler” sekmesinden teklif hazırlayın."} action={q || status ? undefined : <Link href="/firsatlar" className={buttonClass()}>Fırsatlara git</Link>} />
        )}
        <Pagination page={page} total={total} pageCount={Math.ceil(total / PAGE_SIZE)} buildHref={(p) => hrefWith(base, sp, { sayfa: p })} />
      </Card>
    </>
  );
}
