import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireActor } from "@/lib/rbac/guard";
import { contactScope } from "@/lib/rbac/scope";
import { contactSearchWhere } from "@/lib/search";
import { TEMPLATE_CHANNEL_LABELS } from "@/lib/labels";
import { code, fmtDate } from "@/lib/format";
import { renderTemplate, TEMPLATE_VARIABLES } from "@/lib/templates/render";
import { templateContext } from "@/lib/services/templates";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui/primitives";
import { buttonClass, inputClass } from "@/components/ui/styles";
import { CopyText, TemplateForm, ToggleTemplate } from "./forms";

export const metadata = { title: "Mesaj şablonları" };

type SP = { sablon?: string; yeni?: string; arsiv?: string; musteri?: string; q?: string };
const isId = (v: string | undefined): v is string => !!v && /^[0-9a-f-]{36}$/i.test(v);

export default async function TemplatesPage({ searchParams }: { searchParams: Promise<SP> }) {
  const actor = await requireActor();
  const sp = await searchParams;
  const canManage = actor.perms.has("templates.manage");
  const showArchived = sp.arsiv === "1";
  const list = await prisma.messageTemplate.findMany({ where: showArchived ? {} : { active: true }, orderBy: [{ active: "desc" }, { name: "asc" }] });
  const selected = isId(sp.sablon) ? (list.find((t) => t.id === sp.sablon) ?? (await prisma.messageTemplate.findUnique({ where: { id: sp.sablon } }))) : null;
  const creating = canManage && sp.yeni === "1";
  const q = sp.q?.trim();
  const [matches, preview] = await Promise.all([
    selected && q ? prisma.contact.findMany({ where: { AND: [contactScope(actor), contactSearchWhere(q)] }, take: 10, orderBy: { updatedAt: "desc" }, select: { id: true, number: true, fullName: true } }) : [],
    selected && isId(sp.musteri) ? templateContext(actor, sp.musteri).catch(() => null) : null,
  ]);
  const rendered = selected && preview ? { body: renderTemplate(selected.body, preview.ctx), subject: selected.subject ? renderTemplate(selected.subject, preview.ctx) : null } : null;
  const variables = Object.entries(TEMPLATE_VARIABLES).map(([key, label]) => ({ key, label }));
  const channels = Object.entries(TEMPLATE_CHANNEL_LABELS).map(([value, label]) => ({ value, label }));
  const link = (p: Partial<SP>) => {
    const u = new URLSearchParams(Object.entries({ arsiv: showArchived ? "1" : undefined, ...p }).filter((e): e is [string, string] => !!e[1]));
    const s = u.toString();
    return s ? `/sablonlar?${s}` : "/sablonlar";
  };

  return (
    <>
      <PageHeader
        title="Mesaj şablonları"
        description="Ekibin ortak mesaj metinleri. CRM müşteriye otomatik mesaj göndermez: şablonu bir müşteri için doldurup metni kendi e-posta/WhatsApp hesabınızdan iletirsiniz."
        actions={
          canManage ? (
            <Link href={link({ yeni: "1" })} className={buttonClass()}>
              + Yeni şablon
            </Link>
          ) : null
        }
      />
      <div className="grid gap-6 xl:grid-cols-[320px_1fr]">
        <Card
          title="Şablonlar"
          padded={false}
          actions={
            <Link href={showArchived ? "/sablonlar" : "/sablonlar?arsiv=1"} className="text-xs text-accent-ink hover:underline">
              {showArchived ? "Arşivi gizle" : "Arşivi göster"}
            </Link>
          }
        >
          {list.length ? (
            <ul className="divide-y divide-line">
              {list.map((t) => (
                <li key={t.id}>
                  <Link href={link({ sablon: t.id, musteri: sp.musteri })} aria-current={selected?.id === t.id ? "page" : undefined} className={`block px-5 py-3 text-sm hover:bg-surface-2/50 ${selected?.id === t.id ? "bg-accent-soft/50" : ""}`}>
                    <span className="flex items-center justify-between gap-2">
                      <span className={`font-medium ${t.active ? "" : "text-muted line-through"}`}>{t.name}</span>
                      <Badge>{TEMPLATE_CHANNEL_LABELS[t.channel]}</Badge>
                    </span>
                    <span className="mt-0.5 block truncate text-xs text-muted">{t.body}</span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="Henüz şablon yok" description={canManage ? "“Yeni şablon” ile ilk metni ekleyin." : "Yönetici şablon ekleyince burada görünür."} />
          )}
        </Card>

        <div className="min-w-0 space-y-6">
          {creating ? (
            <Card title="Yeni şablon">
              <TemplateForm d={{ name: "", channel: "WHATSAPP", subject: null, body: "Merhaba {{ad}},\n\n" }} channels={channels} variables={variables} />
            </Card>
          ) : selected ? (
            <>
              <Card
                title={selected.name}
                actions={canManage ? <ToggleTemplate id={selected.id} active={selected.active} /> : null}
              >
                {canManage ? (
                  <TemplateForm key={selected.id + selected.updatedAt.getTime()} d={{ id: selected.id, name: selected.name, channel: selected.channel, subject: selected.subject, body: selected.body }} channels={channels} variables={variables} />
                ) : (
                  <div className="space-y-2 text-sm">
                    {selected.subject ? <p className="font-medium">Konu: {selected.subject}</p> : null}
                    <p className="whitespace-pre-line">{selected.body}</p>
                  </div>
                )}
                <p className="mt-3 text-xs text-muted">Son güncelleme: {fmtDate(selected.updatedAt)}</p>
              </Card>
              <Card title="Müşteri için doldur">
                <form className="flex gap-2" role="search">
                  <input type="hidden" name="sablon" value={selected.id} />
                  {showArchived ? <input type="hidden" name="arsiv" value="1" /> : null}
                  <input name="q" defaultValue={q} placeholder="Müşteri ara: ad, telefon, M-no" className={inputClass()} aria-label="Müşteri ara" />
                  <button className={buttonClass("secondary")}>Ara</button>
                </form>
                {q ? (
                  matches.length ? (
                    <ul className="mt-3 flex flex-wrap gap-1.5">
                      {matches.map((c) => (
                        <li key={c.id}>
                          <Link href={link({ sablon: selected.id, musteri: c.id })} className={`inline-block rounded-full border px-2.5 py-1 text-xs ${sp.musteri === c.id ? "border-accent bg-accent-soft text-accent-ink" : "border-line hover:border-accent"}`}>
                            {c.fullName} <span className="tabular text-muted">{code.contact(c.number)}</span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-3 text-sm text-muted">Eşleşen müşteri yok.</p>
                  )
                ) : null}
                {rendered && preview ? (
                  <div className="mt-4 space-y-3 rounded-lg border border-line p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-medium">{preview.contactName} için</p>
                      <CopyText text={(rendered.subject ? `${rendered.subject.text}\n\n` : "") + rendered.body.text} />
                    </div>
                    {rendered.subject ? <p className="text-sm font-medium">Konu: {rendered.subject.text}</p> : null}
                    <p className="whitespace-pre-line text-sm">{rendered.body.text}</p>
                    {[...new Set([...rendered.body.missing, ...(rendered.subject?.missing ?? [])])].length ? (
                      <p role="status" className="rounded-lg bg-warning-soft p-2.5 text-xs text-warning">
                        Bu müşteride değeri olmayan alanlar köşeli parantezle işaretlendi: {[...new Set([...rendered.body.missing, ...(rendered.subject?.missing ?? [])])].join(", ")}. Göndermeden önce elle düzeltin.
                      </p>
                    ) : null}
                  </div>
                ) : isId(sp.musteri) && !preview ? (
                  <p className="mt-3 text-sm text-danger">Müşteri bulunamadı ya da erişiminiz yok.</p>
                ) : null}
              </Card>
            </>
          ) : (
            <Card>
              <EmptyState title="Bir şablon seçin" description="Soldan şablonu seçin; düzenleyebilir ya da bir müşteri için doldurup metni kopyalayabilirsiniz." />
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
