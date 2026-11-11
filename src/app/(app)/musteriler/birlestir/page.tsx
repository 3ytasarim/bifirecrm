import Link from "next/link";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/rbac/guard";
import { contactScope } from "@/lib/rbac/scope";
import { contactSearchWhere } from "@/lib/search";
import { code, fmtDate } from "@/lib/format";
import { formatPhone } from "@/lib/normalize";
import { Card, EmptyState, PageHeader } from "@/components/ui/primitives";
import { buttonClass, inputClass } from "@/components/ui/styles";
import { MergeForm } from "./merge-form";

export const metadata = { title: "Kayıt birleştir" };

type SP = { a?: string; b?: string; qa?: string; qb?: string };
type Picked = Awaited<ReturnType<typeof pick>>;
type Found = { id: string; number: number; fullName: string; primaryPhone: string | null; primaryEmail: string | null }[];

async function pick(actor: Awaited<ReturnType<typeof requirePermission>>, id?: string) {
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) return null;
  return prisma.contact.findFirst({
    where: { id, ...contactScope(actor) },
    select: {
      id: true,
      number: true,
      fullName: true,
      primaryPhone: true,
      primaryEmail: true,
      city: true,
      district: true,
      createdAt: true,
      _count: { select: { opportunities: true, projects: true, tasks: true, attachments: true, activities: true } },
    },
  });
}

function Side({ sp, label, c, results, key_, qkey }: { sp: SP; label: string; c: Picked; results: Found; key_: "a" | "b"; qkey: "qa" | "qb" }) {
  const qs = (patch: Partial<SP>) => {
    const p = new URLSearchParams(Object.entries({ ...sp, ...patch }).filter(([, v]) => v) as [string, string][]);
    return `/musteriler/birlestir?${p.toString()}`;
  };
  return (
    <Card title={label}>
      {c ? (
        <div className="space-y-1 text-sm">
          <p className="font-medium">{c.fullName}</p>
          <p className="text-xs text-muted">
            {code.contact(c.number)} · {fmtDate(c.createdAt)}
          </p>
          <p className="text-xs">{[formatPhone(c.primaryPhone), c.primaryEmail, c.district].filter(Boolean).join(" · ")}</p>
          <p className="text-xs text-muted">
            {c._count.opportunities} fırsat · {c._count.projects} proje · {c._count.tasks} görev · {c._count.attachments} dosya · {c._count.activities} olay
          </p>
          <Link href={qs({ [key_]: undefined })} className="inline-block pt-2 text-xs text-accent-ink hover:underline">
            Değiştir
          </Link>
        </div>
      ) : (
        <>
          <form className="flex gap-2">
            {Object.entries(sp)
              .filter(([k]) => k !== qkey)
              .map(([k, v]) => (
                <input key={k} type="hidden" name={k} value={v} />
              ))}
            <input name={qkey} defaultValue={sp[qkey]} placeholder="Ad, telefon, e-posta, M-no" className={inputClass()} aria-label={`${label} ara`} />
            <button className={buttonClass("secondary")}>Ara</button>
          </form>
          {results.length ? (
            <ul className="mt-3 divide-y divide-line rounded-lg border border-line">
              {results.map((r) => (
                <li key={r.id}>
                  <Link href={qs({ [key_]: r.id })} className="block px-3 py-2 text-sm hover:bg-surface-2">
                    {r.fullName} <span className="text-xs text-muted">{code.contact(r.number)} · {[formatPhone(r.primaryPhone), r.primaryEmail].filter(Boolean).join(" · ")}</span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : sp[qkey] ? (
            <EmptyState title="Sonuç yok" />
          ) : null}
        </>
      )}
    </Card>
  );
}

export default async function MergePage({ searchParams }: { searchParams: Promise<SP> }) {
  const actor = await requirePermission("contacts.merge");
  const sp = await searchParams;
  const [a, b] = await Promise.all([pick(actor, sp.a), pick(actor, sp.b)]);
  const search = async (q?: string) =>
    q ? prisma.contact.findMany({ where: { AND: [contactScope(actor), contactSearchWhere(q)] }, take: 8, select: { id: true, number: true, fullName: true, primaryPhone: true, primaryEmail: true } }) : [];
  const [ra, rb] = await Promise.all([a ? [] : search(sp.qa), b ? [] : search(sp.qb)]);
  return (
    <>
      <PageHeader title="Müşteri kayıtlarını birleştir" description="Aynı kişiye ait iki kartı tek kayıtta toplar. İşlem denetim kaydına yazılır." back={{ href: "/musteriler", label: "Müşteriler" }} />
      <div className="grid gap-6 lg:grid-cols-2">
        <Side sp={sp} label="Korunacak kayıt (kazanan)" c={a} results={ra} key_="a" qkey="qa" />
        <Side sp={sp} label="Birleştirilecek kayıt (kaybeden)" c={b} results={rb} key_="b" qkey="qb" />
      </div>
      {a && b ? (
        a.id === b.id ? (
          <p className="mt-6 text-sm text-danger">Aynı kayıt iki kez seçildi.</p>
        ) : (
          <Card className="mt-6" title="Onay">
            <ul className="mb-4 list-disc space-y-1 pl-5 text-sm text-muted">
              <li>
                <strong className="text-fg">{b.fullName}</strong> kaydının tüm fırsat, proje, görev, not, görüşme, dosya ve izin kayıtları <strong className="text-fg">{a.fullName}</strong> kaydına taşınır.
              </li>
              <li>Kazanan kayıtta boş olan alanlar kaybedenden doldurulur; dolu alanlar değişmez. Telefon/e-postalar ikincil kanal olarak eklenir.</li>
              <li>Kaybeden kayıt silinmez; arşivlenir ve kazanana yönlendirir.</li>
            </ul>
            <MergeForm winnerId={a.id} loserId={b.id} />
          </Card>
        )
      ) : null}
    </>
  );
}
