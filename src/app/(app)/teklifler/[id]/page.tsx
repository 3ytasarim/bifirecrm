import Link from "next/link";
import { notFound } from "next/navigation";
import { FileDown } from "lucide-react";
import { prisma } from "@/lib/db";
import { requireActor } from "@/lib/rbac/guard";
import { quoteScope } from "@/lib/rbac/scope";
import { QUOTE_STATUS_LABELS, QUOTE_STATUS_TONE, QUOTE_UNITS, TAX_RATES } from "@/lib/labels";
import { code, dateOnlyValue, fmtDate, fmtDateTime } from "@/lib/format";
import { calcQuote, formatAmount, formatPct, plainNumber } from "@/lib/quotes/calc";
import { quoteProfile } from "@/lib/services/quotes";
import { Badge, Card, DefList, PageHeader, tableCls } from "@/components/ui/primitives";
import { buttonClass } from "@/components/ui/styles";
import { QuoteEditor } from "../quote-editor";
import { CustomerResponseForm, DecisionForm, QuoteStepButton } from "../quote-actions";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const q = /^[0-9a-f-]{36}$/i.test(id) ? await prisma.quote.findUnique({ where: { id }, select: { number: true } }) : null;
  return { title: q ? `Teklif ${code.quote(q.number)}` : "Teklif" };
}

export default async function QuoteDetail({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireActor();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const q = await prisma.quote.findFirst({
    where: { id, ...quoteScope(actor) },
    include: {
      items: { orderBy: { position: "asc" } },
      approvals: { orderBy: { createdAt: "desc" } },
      contact: { select: { id: true, fullName: true } },
      opportunity: { select: { id: true, number: true, title: true } },
    },
  });
  if (!q) notFound();
  const rootId = q.rootId ?? q.id;
  const [versions, people, profile] = await Promise.all([
    prisma.quote.findMany({ where: { rootId, ...quoteScope(actor) }, orderBy: { version: "desc" }, select: { id: true, number: true, version: true, status: true, grandTotal: true, currency: true, createdAt: true } }),
    prisma.user.findMany({ where: { id: { in: [q.createdById, ...q.approvals.map((a) => a.approverId)].filter(Boolean) as string[] } }, select: { id: true, name: true } }),
    quoteProfile(),
  ]);
  const name = (uid: string | null) => people.find((p) => p.id === uid)?.name ?? "—";
  const can = (p: string) => actor.perms.has(p as never);
  const isDraft = q.status === "DRAFT";
  const canEdit = isDraft && can("quotes.create");
  const selfApproval = q.createdById === actor.id && actor.role !== "SUPER_ADMIN";
  const lastApproval = q.approvals[0];
  const items = q.items.map((i) => ({ description: i.description, quantity: i.quantity.toString(), unit: i.unit, unitPrice: i.unitPrice.toString(), discountPct: i.discountPct.toString(), taxPct: i.taxPct.toString() }));
  const totals = items.length ? calcQuote(items) : null;
  const units = Array.from(new Set([...QUOTE_UNITS, ...items.map((i) => i.unit)]));
  const pdfLabel = q.pdfAttachmentId ? "Gönderilen PDF" : q.status === "APPROVED" ? "PDF önizleme" : "Taslak PDF önizleme";

  return (
    <>
      <PageHeader
        back={{ href: "/teklifler", label: "Teklifler" }}
        title={
          <span className="flex flex-wrap items-center gap-2">
            Teklif {code.quote(q.number)}
            {q.version > 1 ? <span className="text-base font-normal text-muted">· sürüm {q.version}</span> : null}
          </span>
        }
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Link href={`/musteriler/${q.contact.id}`} className="text-accent-ink hover:underline">
              {q.contact.fullName}
            </Link>
            {q.opportunity ? (
              <>
                ·
                <Link href={`/firsatlar/${q.opportunity.id}`} className="text-accent-ink hover:underline">
                  {code.opportunity(q.opportunity.number)} {q.opportunity.title}
                </Link>
              </>
            ) : null}
            <Badge tone={QUOTE_STATUS_TONE[q.status]}>{QUOTE_STATUS_LABELS[q.status]}</Badge>
          </span>
        }
        actions={
          items.length ? (
            <a href={`/api/quotes/${q.id}/pdf`} target="_blank" rel="noopener" className={buttonClass("secondary")}>
              <FileDown className="size-4" aria-hidden /> {pdfLabel}
            </a>
          ) : null
        }
      />

      <div className="grid gap-6 xl:grid-cols-[1fr_320px]">
        <div className="min-w-0 space-y-6">
          {isDraft && lastApproval?.decision === "REJECTED" ? (
            <div role="alert" className="rounded-lg border border-danger/30 bg-danger-soft p-4 text-sm text-danger">
              <p className="font-medium">Onaylayan reddetti ({name(lastApproval.approverId)}, {fmtDateTime(lastApproval.createdAt)})</p>
              {lastApproval.note ? <p className="mt-1 whitespace-pre-line">{lastApproval.note}</p> : null}
            </div>
          ) : null}
          {canEdit ? (
            <Card title="Kalemler">
              <QuoteEditor
                id={q.id}
                initial={q.items.map((i) => ({ key: i.id, description: i.description, quantity: plainNumber(i.quantity.toString()), unit: i.unit, unitPrice: plainNumber(i.unitPrice.toString()), discountPct: plainNumber(i.discountPct.toString()), taxPct: plainNumber(i.taxPct.toString()) }))}
                currency={q.currency}
                validUntil={dateOnlyValue(q.validUntil)}
                notes={q.notes ?? ""}
                terms={q.terms ?? profile.terms}
                units={units}
                taxRates={Array.from(new Set([...TAX_RATES, ...q.items.map((i) => plainNumber(i.taxPct.toString()))]))}
              />
            </Card>
          ) : (
            <Card title="Kalemler" padded={false}>
              <div className={tableCls.wrap}>
                <table className={tableCls.table}>
                  <thead>
                    <tr>
                      <th className={tableCls.th}>#</th>
                      <th className={tableCls.th}>Açıklama</th>
                      <th className={`${tableCls.th} text-right`}>Miktar</th>
                      <th className={`${tableCls.th} text-right`}>Birim fiyat</th>
                      <th className={`${tableCls.th} text-right`}>İsk.</th>
                      <th className={`${tableCls.th} text-right`}>KDV</th>
                      <th className={`${tableCls.th} text-right`}>Tutar</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((it, i) => (
                      <tr key={i} className={tableCls.row}>
                        <td className={`${tableCls.td} text-xs tabular text-muted`}>{i + 1}</td>
                        <td className={`${tableCls.td} whitespace-pre-line`}>{it.description}</td>
                        <td className={`${tableCls.td} text-right tabular`}>
                          {plainNumber(it.quantity)} {it.unit}
                        </td>
                        <td className={`${tableCls.td} text-right tabular`}>{formatAmount(it.unitPrice, q.currency)}</td>
                        <td className={`${tableCls.td} text-right tabular`}>{Number(it.discountPct) ? formatPct(it.discountPct) : "—"}</td>
                        <td className={`${tableCls.td} text-right tabular`}>{formatPct(it.taxPct)}</td>
                        <td className={`${tableCls.td} text-right font-medium tabular`}>{formatAmount(totals!.items[i].net, q.currency)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="ml-auto max-w-sm space-y-1.5 p-5 text-sm">
                <TotalRow label="Ara toplam" value={formatAmount(q.subtotal.toString(), q.currency)} />
                {Number(q.discountTotal) ? <TotalRow label="İskonto" value={"−" + formatAmount(q.discountTotal.toString(), q.currency)} /> : null}
                {totals?.taxBreakdown.map((t) => <TotalRow key={t.rate} label={`KDV ${formatPct(t.rate)}`} value={formatAmount(t.tax, q.currency)} />)}
                <div className="flex justify-between border-t border-line pt-2 text-base font-semibold">
                  <span>Genel toplam</span>
                  <span className="tabular">{formatAmount(q.grandTotal.toString(), q.currency)}</span>
                </div>
              </div>
              {q.notes || q.terms ? (
                <div className="grid gap-4 border-t border-line p-5 text-sm lg:grid-cols-2">
                  {q.notes ? (
                    <div>
                      <p className="font-medium">Notlar</p>
                      <p className="mt-1 whitespace-pre-line text-muted">{q.notes}</p>
                    </div>
                  ) : null}
                  {q.terms ? (
                    <div>
                      <p className="font-medium">Teklif şartları</p>
                      <p className="mt-1 whitespace-pre-line text-muted">{q.terms}</p>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </Card>
          )}
        </div>

        <div className="space-y-6">
          <Card title="Durum">
            <DefList
              items={[
                { label: "Durum", value: <Badge tone={QUOTE_STATUS_TONE[q.status]}>{QUOTE_STATUS_LABELS[q.status]}</Badge> },
                { label: "Genel toplam", value: <span className="font-semibold tabular">{formatAmount(q.grandTotal.toString(), q.currency)}</span> },
                { label: "Geçerlilik", value: fmtDate(q.validUntil) },
                { label: "Hazırlayan", value: name(q.createdById) },
                { label: "Gönderim", value: q.sentAt ? fmtDateTime(q.sentAt) : null },
              ]}
            />
            <div className="mt-4 space-y-2 border-t border-line pt-4">
              {isDraft && can("quotes.create") ? (
                <>
                  <QuoteStepButton id={q.id} kind="submit" label="Onaya gönder" />
                  <p className="text-xs text-muted">Kaydedilmemiş değişiklikler onaya gitmez; önce “Taslağı kaydet”.</p>
                </>
              ) : null}
              {q.status === "PENDING_APPROVAL" ? (
                can("quotes.approve") && !selfApproval ? (
                  <DecisionForm id={q.id} />
                ) : (
                  <p className="text-sm text-muted">{selfApproval && can("quotes.approve") ? "Kendi hazırladığınız teklifi başka bir yetkili onaylamalı." : "Yetkili onayı bekleniyor."}</p>
                )
              ) : null}
              {q.status === "APPROVED" && can("quotes.send") ? (
                <>
                  <QuoteStepButton id={q.id} kind="sent" label="Müşteriye gönderildi olarak işaretle" />
                  <p className="text-xs text-muted">PDF kalıcı olarak kaydedilir ve fırsat dosyalarına eklenir. Otomatik e-posta/WhatsApp gönderimi yok; PDF&apos;i siz iletirsiniz.</p>
                </>
              ) : null}
              {q.status === "SENT" && can("quotes.send") ? <CustomerResponseForm id={q.id} /> : null}
              {["APPROVED", "SENT", "REJECTED", "PENDING_APPROVAL"].includes(q.status) && can("quotes.create") ? <QuoteStepButton id={q.id} kind="revise" label="Revize et (yeni sürüm)" variant="secondary" /> : null}
              {isDraft && can("quotes.create") ? <QuoteStepButton id={q.id} kind="delete" label="Taslağı sil" variant="danger" /> : null}
            </div>
          </Card>

          <Card title="Onay geçmişi">
            {q.approvals.length ? (
              <ol className="space-y-3 text-sm">
                {q.approvals.map((a) => (
                  <li key={a.id}>
                    <div className="flex items-center justify-between gap-2">
                      <Badge tone={a.decision === "APPROVED" ? "success" : "danger"}>{a.decision === "APPROVED" ? "Onaylandı" : "Reddedildi"}</Badge>
                      <span className="text-xs tabular text-muted">{fmtDateTime(a.createdAt)}</span>
                    </div>
                    <p className="mt-1 text-xs text-muted">{name(a.approverId)}</p>
                    {a.note ? <p className="mt-1 whitespace-pre-line text-xs">{a.note}</p> : null}
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-sm text-muted">Henüz onay kararı yok.</p>
            )}
          </Card>

          {versions.length > 1 ? (
            <Card title="Sürümler" padded={false}>
              <ul className="divide-y divide-line">
                {versions.map((v) => (
                  <li key={v.id}>
                    <Link href={`/teklifler/${v.id}`} aria-current={v.id === q.id ? "page" : undefined} className={`flex items-center justify-between gap-2 px-5 py-2.5 text-sm hover:bg-surface-2/50 ${v.id === q.id ? "bg-accent-soft/50" : ""}`}>
                      <span>
                        <span className="font-medium">Sürüm {v.version}</span>
                        <span className="block text-xs text-muted">
                          {code.quote(v.number)} · {formatAmount(v.grandTotal.toString(), v.currency)}
                        </span>
                      </span>
                      <Badge tone={QUOTE_STATUS_TONE[v.status]}>{QUOTE_STATUS_LABELS[v.status]}</Badge>
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}

function TotalRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-muted">
      <span>{label}</span>
      <span className="tabular text-fg">{value}</span>
    </div>
  );
}
