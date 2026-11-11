import Link from "next/link";
import type { LeadSource, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireActor } from "@/lib/rbac/guard";
import { contactScope } from "@/lib/rbac/scope";
import { contactSearchWhere } from "@/lib/search";
import { SOURCE_LABELS } from "@/lib/labels";
import { code, fmtDate } from "@/lib/format";
import { formatPhone, tagKey } from "@/lib/normalize";
import { activeUsers, hrefWith, pageParam, PAGE_SIZE } from "@/lib/queries";
import { Badge, Card, EmptyState, PageHeader, Pagination, tableCls } from "@/components/ui/primitives";
import { buttonClass, inputClass } from "@/components/ui/styles";

export const metadata = { title: "Müşteriler" };

type SP = { q?: string; kaynak?: string; sorumlu?: string; il?: string; etiket?: string; sayfa?: string };

export default async function ContactsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const actor = await requireActor();
  if (!actor.perms.has("contacts.view") && !actor.perms.has("contacts.view_all")) {
    const { redirect } = await import("next/navigation");
    redirect("/yetkisiz");
  }
  const sp = await searchParams;
  const page = pageParam(sp.sayfa);
  const source = sp.kaynak && sp.kaynak in SOURCE_LABELS ? (sp.kaynak as LeadSource) : undefined;
  const where: Prisma.ContactWhereInput = {
    AND: [
      contactScope(actor),
      contactSearchWhere(sp.q),
      source ? { source } : {},
      sp.sorumlu === "yok" ? { ownerId: null } : sp.sorumlu && /^[0-9a-f-]{36}$/.test(sp.sorumlu) ? { ownerId: sp.sorumlu } : {},
      sp.il ? { city: { equals: sp.il, mode: "insensitive" } } : {},
      sp.etiket ? { tags: { has: tagKey(sp.etiket) } } : {},
    ],
  };
  const [rows, total, users] = await Promise.all([
    prisma.contact.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: {
        id: true,
        number: true,
        fullName: true,
        primaryPhone: true,
        primaryEmail: true,
        city: true,
        district: true,
        source: true,
        tags: true,
        createdAt: true,
        owner: { select: { name: true } },
        organization: { select: { name: true } },
        _count: { select: { opportunities: { where: { deletedAt: null } }, projects: { where: { deletedAt: null } } } },
      },
    }),
    prisma.contact.count({ where }),
    activeUsers(),
  ]);
  const base = "/musteriler";
  const exportHref = hrefWith("/api/export/contacts", sp, { sayfa: undefined });

  return (
    <>
      <PageHeader
        title="Müşteriler"
        description={actor.perms.has("contacts.view_all") ? "Tüm müşteri kayıtları" : "Size bağlı müşteri kayıtları"}
        actions={
          <>
            {actor.perms.has("data.export") ? (
              <a href={exportHref} className={buttonClass("secondary")}>
                CSV dışa aktar
              </a>
            ) : null}
            {actor.perms.has("contacts.merge") ? (
              <Link href="/musteriler/birlestir" className={buttonClass("secondary")}>
                Kayıt birleştir
              </Link>
            ) : null}
            {actor.perms.has("contacts.create") ? (
              <Link href="/musteriler/yeni" className={buttonClass()}>
                + Yeni müşteri
              </Link>
            ) : null}
          </>
        }
      />
      <Card padded={false}>
        <form className="grid gap-2 border-b border-line p-4 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr_1fr_auto]" role="search">
          <input name="q" defaultValue={sp.q} placeholder="Ad, telefon, e-posta, şirket, M-no" className={inputClass()} aria-label="Müşteri ara" />
          <select name="kaynak" defaultValue={source ?? ""} className={inputClass()} aria-label="Kaynak">
            <option value="">Tüm kaynaklar</option>
            {Object.entries(SOURCE_LABELS).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
          <select name="sorumlu" defaultValue={sp.sorumlu ?? ""} className={inputClass()} aria-label="Sorumlu">
            <option value="">Tüm sorumlular</option>
            <option value="yok">Atanmamış</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
          <input name="il" defaultValue={sp.il} placeholder="İl" className={inputClass()} aria-label="İl" />
          <button className={buttonClass("secondary")}>Filtrele</button>
        </form>
        {rows.length ? (
          <div className={tableCls.wrap}>
            <table className={tableCls.table}>
              <thead>
                <tr>
                  <th className={tableCls.th}>Müşteri</th>
                  <th className={tableCls.th}>İletişim</th>
                  <th className={tableCls.th}>Konum</th>
                  <th className={tableCls.th}>Kaynak</th>
                  <th className={tableCls.th}>Fırsat / Proje</th>
                  <th className={tableCls.th}>Sorumlu</th>
                  <th className={tableCls.th}>Kayıt</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => (
                  <tr key={c.id} className={tableCls.row}>
                    <td className={tableCls.td}>
                      <Link href={`/musteriler/${c.id}`} className="font-medium text-fg hover:text-accent-ink hover:underline">
                        {c.fullName}
                      </Link>
                      <span className="block text-xs text-muted">
                        {code.contact(c.number)}
                        {c.organization ? ` · ${c.organization.name}` : ""}
                      </span>
                      {c.tags.length ? (
                        <span className="mt-1 flex flex-wrap gap-1">
                          {c.tags.map((t) => (
                            <Link key={t} href={hrefWith(base, sp, { etiket: t, sayfa: undefined })}>
                              <Badge>{t}</Badge>
                            </Link>
                          ))}
                        </span>
                      ) : null}
                    </td>
                    <td className={`${tableCls.td} text-xs`}>
                      <span className="block tabular">{formatPhone(c.primaryPhone) || "—"}</span>
                      <span className="block text-muted">{c.primaryEmail}</span>
                    </td>
                    <td className={`${tableCls.td} text-muted`}>{[c.district, c.city].filter(Boolean).join(", ") || "—"}</td>
                    <td className={tableCls.td}>
                      <Badge>{SOURCE_LABELS[c.source]}</Badge>
                    </td>
                    <td className={`${tableCls.td} tabular text-muted`}>
                      {c._count.opportunities} / {c._count.projects}
                    </td>
                    <td className={`${tableCls.td} text-muted`}>{c.owner?.name ?? "—"}</td>
                    <td className={`${tableCls.td} tabular text-muted`}>{fmtDate(c.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            title={sp.q || source || sp.sorumlu || sp.il || sp.etiket ? "Filtreye uyan müşteri yok" : "Henüz müşteri yok"}
            description="Hızlı kayıtla ya da yeni müşteri formuyla ekleyin."
            action={actor.perms.has("contacts.create") ? <Link href="/talepler/yeni" className={buttonClass()}>Hızlı kayıt</Link> : undefined}
          />
        )}
        <Pagination page={page} total={total} pageCount={Math.ceil(total / PAGE_SIZE)} buildHref={(p) => hrefWith(base, sp, { sayfa: p })} />
      </Card>
    </>
  );
}
