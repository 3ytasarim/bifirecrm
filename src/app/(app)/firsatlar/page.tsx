import Link from "next/link";
import type { FireplaceType, LeadSource, OpportunityStage, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireActor } from "@/lib/rbac/guard";
import { opportunityScope } from "@/lib/rbac/scope";
import { contactSearchWhere } from "@/lib/search";
import { FIREPLACE_LABELS, LOST_REASONS, SOURCE_LABELS, STAGE_LABELS, STAGE_ORDER } from "@/lib/labels";
import { code, daysAgo, fmtDate, fmtDateTime, fmtMoney, nowMs, parseDateOnly } from "@/lib/format";
import { activeUsers, hrefWith, pageParam, PAGE_SIZE } from "@/lib/queries";
import { Badge, Card, EmptyState, PageHeader, Pagination, tableCls } from "@/components/ui/primitives";
import { buttonClass, inputClass } from "@/components/ui/styles";
import { Kanban, type KanbanCard } from "./kanban";

export const metadata = { title: "Satış Fırsatları" };

type SP = { gorunum?: string; q?: string; sorumlu?: string; kaynak?: string; tur?: string; asama?: string; tarih?: string; baslangic?: string; bitis?: string; sayfa?: string };

export default async function OpportunitiesPage({ searchParams }: { searchParams: Promise<SP> }) {
  const actor = await requireActor();
  if (!actor.perms.has("opportunities.view") && !actor.perms.has("opportunities.view_all")) {
    const { redirect } = await import("next/navigation");
    redirect("/yetkisiz");
  }
  const sp = await searchParams;
  const view = sp.gorunum === "tablo" ? "tablo" : "kanban";
  const source = sp.kaynak && sp.kaynak in SOURCE_LABELS ? (sp.kaynak as LeadSource) : undefined;
  const type = sp.tur && sp.tur in FIREPLACE_LABELS ? (sp.tur as FireplaceType) : undefined;
  const stages = (sp.asama ?? "").split(",").filter((s): s is OpportunityStage => s in STAGE_LABELS);
  const days = Number(sp.tarih);
  const from = parseDateOnly(sp.baslangic);
  const to = parseDateOnly(sp.bitis);
  const createdAt: Prisma.DateTimeFilter | undefined =
    Number.isInteger(days) && days > 0 ? { gte: daysAgo(days) } : from || to ? { ...(from ? { gte: from } : {}), ...(to ? { lt: new Date(to.getTime() + 86400_000) } : {}) } : undefined;

  const where: Prisma.OpportunityWhereInput = {
    AND: [
      opportunityScope(actor),
      sp.q ? { OR: [{ title: { contains: sp.q, mode: "insensitive" } }, { contact: contactSearchWhere(sp.q) }, ...(/^f-?0*\d+$/i.test(sp.q) ? [{ number: Number(sp.q.replace(/\D/g, "")) }] : [])] } : {},
      source ? { source } : {},
      type ? { fireplaceType: type } : {},
      sp.sorumlu === "yok" ? { ownerId: null } : sp.sorumlu && /^[0-9a-f-]{36}$/.test(sp.sorumlu) ? { ownerId: sp.sorumlu } : {},
      createdAt ? { createdAt } : {},
      view === "tablo" && stages.length ? { stage: { in: stages } } : {},
      // Kanban'da kapanmış (kazanılan/kaybedilen) fırsatlar son 90 günle sınırlı.
      view === "kanban" ? { OR: [{ stage: { notIn: ["WON", "LOST"] } }, { updatedAt: { gte: daysAgo(90) } }] } : {},
    ],
  };
  const users = await activeUsers();
  const base = "/firsatlar";
  const canEdit = actor.perms.has("opportunities.edit");

  const filters = (
    <form className="mb-4 grid gap-2 rounded-xl border border-line bg-surface p-3 shadow-card sm:grid-cols-2 lg:grid-cols-[2fr_repeat(5,1fr)_auto]" role="search">
      <input type="hidden" name="gorunum" value={view} />
      <input name="q" defaultValue={sp.q} placeholder="Müşteri, başlık, F-no" className={inputClass()} aria-label="Fırsat ara" />
      <select name="sorumlu" defaultValue={sp.sorumlu ?? ""} className={inputClass()} aria-label="Sorumlu">
        <option value="">Tüm sorumlular</option>
        <option value="yok">Atanmamış</option>
        {users.map((u) => (
          <option key={u.id} value={u.id}>
            {u.name}
          </option>
        ))}
      </select>
      <select name="kaynak" defaultValue={source ?? ""} className={inputClass()} aria-label="Kaynak">
        <option value="">Tüm kaynaklar</option>
        {Object.entries(SOURCE_LABELS).map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
      <select name="tur" defaultValue={type ?? ""} className={inputClass()} aria-label="Ürün türü">
        <option value="">Tüm ürün türleri</option>
        {Object.entries(FIREPLACE_LABELS).map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
      <input type="date" name="baslangic" defaultValue={sp.baslangic} className={inputClass()} aria-label="Başlangıç tarihi" />
      <input type="date" name="bitis" defaultValue={sp.bitis} className={inputClass()} aria-label="Bitiş tarihi" />
      <button className={buttonClass("secondary")}>Filtrele</button>
    </form>
  );

  const header = (
    <PageHeader
      title="Satış Fırsatları"
      description={actor.perms.has("opportunities.view_all") ? "Tüm ekip fırsatları" : "Size bağlı fırsatlar"}
      actions={
        <>
          <div className="inline-flex rounded-lg border border-line bg-surface p-0.5" role="group" aria-label="Görünüm">
            <Link href={hrefWith(base, sp, { gorunum: undefined, sayfa: undefined })} aria-current={view === "kanban" ? "page" : undefined} className={`rounded-md px-3 py-1.5 text-sm ${view === "kanban" ? "bg-accent-soft font-medium text-accent-ink" : "text-muted"}`}>
              Kanban
            </Link>
            <Link href={hrefWith(base, sp, { gorunum: "tablo" })} aria-current={view === "tablo" ? "page" : undefined} className={`rounded-md px-3 py-1.5 text-sm ${view === "tablo" ? "bg-accent-soft font-medium text-accent-ink" : "text-muted"}`}>
              Tablo
            </Link>
          </div>
          {actor.perms.has("data.export") ? (
            <a href={hrefWith("/api/export/opportunities", sp, { sayfa: undefined, gorunum: undefined })} className={buttonClass("secondary")}>
              CSV
            </a>
          ) : null}
          {actor.perms.has("contacts.create") ? (
            <Link href="/talepler/yeni" className={buttonClass()}>
              + Hızlı kayıt
            </Link>
          ) : null}
        </>
      }
    />
  );

  if (view === "kanban") {
    const rows = await prisma.opportunity.findMany({
      where,
      orderBy: { position: "asc" },
      take: 1000,
      select: { id: true, number: true, title: true, stage: true, position: true, source: true, estimatedAmount: true, currency: true, nextActionAt: true, contact: { select: { fullName: true } }, owner: { select: { name: true } } },
    });
    const now = nowMs();
    const cards: KanbanCard[] = rows.map((o) => ({
      id: o.id,
      code: code.opportunity(o.number),
      title: o.title,
      contact: o.contact.fullName,
      owner: o.owner?.name ?? null,
      amount: o.estimatedAmount ? fmtMoney(o.estimatedAmount, o.currency) : null,
      source: SOURCE_LABELS[o.source],
      nextActionAt: o.nextActionAt ? fmtDateTime(o.nextActionAt) : null,
      overdue: !!o.nextActionAt && o.nextActionAt.getTime() < now && o.stage !== "WON" && o.stage !== "LOST",
      stage: o.stage,
      position: o.position,
    }));
    return (
      <>
        {header}
        {filters}
        {rows.length === 0 && !sp.q && !source && !sp.sorumlu ? (
          <Card>
            <EmptyState title="Henüz fırsat yok" description="Hızlı kayıtla ilk talebi girin; fırsat “Yeni” kolonunda görünür." action={<Link href="/talepler/yeni" className={buttonClass()}>Hızlı kayıt</Link>} />
          </Card>
        ) : (
          <Kanban key={JSON.stringify(sp)} columns={STAGE_ORDER.map((s) => ({ stage: s, label: STAGE_LABELS[s] }))} initial={cards} lostReasons={LOST_REASONS} canEdit={canEdit} />
        )}
      </>
    );
  }

  const page = pageParam(sp.sayfa);
  const [rows, total, sum] = await Promise.all([
    prisma.opportunity.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: { id: true, number: true, title: true, stage: true, source: true, fireplaceType: true, estimatedAmount: true, currency: true, nextActionAt: true, lastContactAt: true, createdAt: true, contact: { select: { id: true, fullName: true } }, owner: { select: { name: true } } },
    }),
    prisma.opportunity.count({ where }),
    prisma.opportunity.aggregate({ where: { AND: [where, { currency: "TRY" }] }, _sum: { estimatedAmount: true } }),
  ]);
  return (
    <>
      {header}
      {filters}
      <div className="mb-3 flex flex-wrap gap-1.5">
        {STAGE_ORDER.map((s) => {
          const on = stages.includes(s);
          const next = on ? stages.filter((x) => x !== s) : [...stages, s];
          return (
            <Link key={s} href={hrefWith(base, sp, { asama: next.join(",") || undefined, sayfa: undefined })} className={`rounded-full border px-2.5 py-1 text-xs ${on ? "border-accent bg-accent-soft text-accent-ink" : "border-line bg-surface text-muted hover:text-fg"}`}>
              {STAGE_LABELS[s]}
            </Link>
          );
        })}
      </div>
      <Card padded={false}>
        {rows.length ? (
          <div className={tableCls.wrap}>
            <table className={tableCls.table}>
              <thead>
                <tr>
                  <th className={tableCls.th}>No</th>
                  <th className={tableCls.th}>Müşteri / Başlık</th>
                  <th className={tableCls.th}>Aşama</th>
                  <th className={tableCls.th}>Kaynak</th>
                  <th className={`${tableCls.th} text-right`}>Tahmini tutar</th>
                  <th className={tableCls.th}>Son temas</th>
                  <th className={tableCls.th}>Sonraki aksiyon</th>
                  <th className={tableCls.th}>Sorumlu</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((o) => (
                  <tr key={o.id} className={tableCls.row}>
                    <td className={`${tableCls.td} tabular text-xs text-muted`}>{code.opportunity(o.number)}</td>
                    <td className={tableCls.td}>
                      <Link href={`/firsatlar/${o.id}`} className="font-medium hover:text-accent-ink hover:underline">
                        {o.contact.fullName}
                      </Link>
                      <span className="block text-xs text-muted">{o.title}</span>
                    </td>
                    <td className={tableCls.td}>
                      <Badge tone={o.stage === "WON" ? "success" : o.stage === "LOST" ? "danger" : "info"}>{STAGE_LABELS[o.stage]}</Badge>
                    </td>
                    <td className={`${tableCls.td} text-xs`}>{SOURCE_LABELS[o.source]}</td>
                    <td className={`${tableCls.td} text-right tabular`}>{o.estimatedAmount ? fmtMoney(o.estimatedAmount, o.currency) : "—"}</td>
                    <td className={`${tableCls.td} text-xs text-muted`}>{fmtDate(o.lastContactAt)}</td>
                    <td className={`${tableCls.td} text-xs ${o.nextActionAt && o.nextActionAt < new Date() && !["WON", "LOST"].includes(o.stage) ? "font-medium text-danger" : "text-muted"}`}>{fmtDateTime(o.nextActionAt)}</td>
                    <td className={`${tableCls.td} text-xs`}>{o.owner?.name ?? <span className="text-danger">Atanmamış</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState title="Filtreye uyan fırsat yok" />
        )}
        <div className="flex items-center justify-between border-t border-line px-5 py-2 text-xs text-muted">
          <span>Filtrelenen TRY fırsatların tahmini toplamı: {fmtMoney(sum._sum.estimatedAmount ?? 0)}</span>
        </div>
        <Pagination page={page} total={total} pageCount={Math.ceil(total / PAGE_SIZE)} buildHref={(p) => hrefWith(base, sp, { sayfa: p })} />
      </Card>
    </>
  );
}
