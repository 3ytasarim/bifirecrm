import Link from "next/link";
import { redirect } from "next/navigation";
import { requireActor } from "@/lib/rbac/guard";
import { nowMs } from "@/lib/format";
import { salesReport } from "@/lib/services/reports";
import { audit } from "@/lib/audit";
import { QUOTE_STATUS_LABELS, SOURCE_LABELS, STAGE_LABELS, STAGE_ORDER } from "@/lib/labels";
import { activeUsers, hrefWith } from "@/lib/queries";
import { formatAmount } from "@/lib/quotes/calc";
import { Card, EmptyState, PageHeader, Stat, tableCls } from "@/components/ui/primitives";
import { buttonClass, inputClass } from "@/components/ui/styles";

export const metadata = { title: "Raporlar" };

type SP = { baslangic?: string; bitis?: string; sorumlu?: string };

const IST = 3 * 3600_000;
const isDay = (v: string | undefined): v is string => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));
const istDay = (ms: number) => new Date(ms + IST).toISOString().slice(0, 10);
const istStart = (day: string) => new Date(`${day}T00:00:00+03:00`);
const pct = (a: number, b: number) => (b ? `%${((a / b) * 100).toLocaleString("tr-TR", { maximumFractionDigits: 1 })}` : "—");
function dur(h: number | null) {
  if (h === null || Number.isNaN(h)) return "—";
  if (h < 1) return `${Math.round(h * 60)} dk`;
  if (h < 48) return `${h.toLocaleString("tr-TR", { maximumFractionDigits: 1 })} sa`;
  return `${(h / 24).toLocaleString("tr-TR", { maximumFractionDigits: 1 })} gün`;
}

export default async function ReportsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const actor = await requireActor();
  if (!actor.perms.has("reports.view")) redirect("/yetkisiz");
  const sp = await searchParams;
  const now = nowMs();
  const today = istDay(now);
  const end = isDay(sp.bitis) ? sp.bitis : today;
  let start = isDay(sp.baslangic) ? sp.baslangic : istDay(now - 29 * 86400_000);
  if (start > end) start = end;
  const users = await activeUsers();
  const ownerId = sp.sorumlu && users.some((u) => u.id === sp.sorumlu) ? sp.sorumlu : null;
  const from = istStart(start);
  const to = new Date(istStart(end).getTime() + 86400_000);
  const r = await salesReport(actor, { from, to, ownerId });
  await audit({ actorId: actor.id, action: "report_view", entityType: "report", summary: `Satış raporu ${start} – ${end}${ownerId ? " (sorumlu filtresi)" : ""}` });

  const base = "/raporlar";
  const presets = [
    { label: "Son 7 gün", s: istDay(now - 6 * 86400_000), e: today },
    { label: "Son 30 gün", s: istDay(now - 29 * 86400_000), e: today },
    { label: "Son 90 gün", s: istDay(now - 89 * 86400_000), e: today },
    { label: "Bu ay", s: today.slice(0, 8) + "01", e: today },
    { label: "Bu yıl", s: today.slice(0, 5) + "01-01", e: today },
  ];
  const maxSource = Math.max(1, ...r.bySource.map((s) => s.total));
  const maxLost = Math.max(1, ...r.lost.map((s) => s.count));
  const lostTotal = r.lost.reduce((a, b) => a + b.count, 0);
  const stages = STAGE_ORDER.filter((s) => s !== "WON" && s !== "LOST").map((s) => r.stages.find((x) => x.stage === s) ?? { stage: s, count: 0, avgHours: null, medianHours: null });
  const decided = r.quotes.filter((q) => q.status === "ACCEPTED" || q.status === "REJECTED");
  const accepted = decided.filter((q) => q.status === "ACCEPTED").reduce((a, b) => a + b.count, 0);
  const decidedCount = decided.reduce((a, b) => a + b.count, 0);

  return (
    <>
      <PageHeader title="Raporlar" description="Satış hunisi, kaynaklar, kayıp nedenleri ve hız ölçüleri. Rakamlar doğrudan veritabanından hesaplanır." />
      <form className="mb-3 grid gap-2 rounded-xl border border-line bg-surface p-3 shadow-card sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1.5fr_auto]">
        <label className="text-xs text-muted">
          Başlangıç
          <input type="date" name="baslangic" defaultValue={start} max={today} className={`${inputClass()} mt-1`} />
        </label>
        <label className="text-xs text-muted">
          Bitiş
          <input type="date" name="bitis" defaultValue={end} max={today} className={`${inputClass()} mt-1`} />
        </label>
        <label className="text-xs text-muted">
          Sorumlu
          <select name="sorumlu" defaultValue={ownerId ?? ""} className={`${inputClass()} mt-1`}>
            <option value="">Tüm ekip</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        </label>
        <button className={`${buttonClass("secondary")} self-end`}>Uygula</button>
      </form>
      <div className="mb-6 flex flex-wrap gap-1.5">
        {presets.map((p) => {
          const on = p.s === start && p.e === end;
          return (
            <Link key={p.label} href={hrefWith(base, sp, { baslangic: p.s, bitis: p.e })} className={`rounded-full border px-2.5 py-1 text-xs ${on ? "border-accent bg-accent-soft text-accent-ink" : "border-line bg-surface text-muted hover:text-fg"}`}>
              {p.label}
            </Link>
          );
        })}
      </div>

      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Yeni fırsat" value={r.funnel.total} hint={`${start.split("-").reverse().join(".")} – ${end.split("-").reverse().join(".")}`} />
        <Stat label="Temas kurulan" value={r.funnel.contacted} hint={pct(r.funnel.contacted, r.funnel.total)} />
        <Stat label="Teklif gönderilen" value={r.funnel.quoted} hint={pct(r.funnel.quoted, r.funnel.total)} />
        <Stat label="Kazanılan" value={r.funnel.won} hint={`Dönüşüm ${pct(r.funnel.won, r.funnel.total)}`} tone="accent" />
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card title="Kaynağa göre fırsatlar ve dönüşüm" padded={false}>
          {r.bySource.length ? (
            <div className={tableCls.wrap}>
              <table className={tableCls.table}>
                <thead>
                  <tr>
                    <th className={tableCls.th}>Kaynak</th>
                    <th className={`${tableCls.th} text-right`}>Fırsat</th>
                    <th className={`${tableCls.th} text-right`}>Açık</th>
                    <th className={`${tableCls.th} text-right`}>Kazanılan</th>
                    <th className={`${tableCls.th} text-right`}>Kaybedilen</th>
                    <th className={`${tableCls.th} text-right`}>Dönüşüm</th>
                  </tr>
                </thead>
                <tbody>
                  {r.bySource.map((s) => (
                    <tr key={s.source} className={tableCls.row}>
                      <td className={tableCls.td}>
                        {SOURCE_LABELS[s.source]}
                        <span className="mt-1 block h-1.5 rounded-full bg-accent/70" style={{ width: `${(s.total / maxSource) * 100}%` }} aria-hidden />
                      </td>
                      <td className={`${tableCls.td} text-right tabular`}>{s.total}</td>
                      <td className={`${tableCls.td} text-right tabular`}>{s.open}</td>
                      <td className={`${tableCls.td} text-right tabular`}>{s.won}</td>
                      <td className={`${tableCls.td} text-right tabular`}>{s.lost}</td>
                      <td className={`${tableCls.td} text-right font-medium tabular`}>{pct(s.won, s.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState title="Bu aralıkta fırsat yok" />
          )}
          <p className="border-t border-line px-5 py-2 text-xs text-muted">Aralıkta oluşturulan fırsatlar; kazanılan/kaybedilen bugünkü aşamaya göre.</p>
        </Card>

        <Card title={`Kayıp nedenleri (${lostTotal})`} padded={false}>
          {r.lost.length ? (
            <ul className="space-y-3 p-5">
              {r.lost.map((l) => (
                <li key={l.reason} className="text-sm">
                  <div className="flex justify-between gap-2">
                    <span>{l.reason}</span>
                    <span className="tabular text-muted">
                      {l.count} · {pct(l.count, lostTotal)}
                    </span>
                  </div>
                  <span className="mt-1 block h-1.5 rounded-full bg-danger/60" style={{ width: `${(l.count / maxLost) * 100}%` }} aria-hidden />
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="Bu aralıkta kaybedilen fırsat yok" />
          )}
          <p className="border-t border-line px-5 py-2 text-xs text-muted">Aralıkta “Kaybedildi” aşamasına geçen fırsatlar.</p>
        </Card>

        <Card title="İlk temas hızı">
          <div className="grid gap-3 sm:grid-cols-2">
            <Stat label="Medyan süre" value={dur(r.firstContact.medianHours)} hint={`Ortalama ${dur(r.firstContact.avgHours)}`} />
            <Stat label="24 saat içinde temas" value={pct(r.firstContact.within24, r.firstContact.total)} hint={`${r.firstContact.within24} / ${r.firstContact.total} fırsat`} />
          </div>
          <p className="mt-3 text-sm">
            Temas kaydı olmayan fırsat: <span className="font-semibold tabular">{r.firstContact.total - r.firstContact.contacted}</span>
          </p>
          <p className="mt-2 text-xs text-muted">Fırsat oluşturulmasından fırsata bağlı ilk arama / WhatsApp / e-posta / görüşme / ziyaret kaydına kadar geçen süre.</p>
        </Card>

        <Card title="Aşamalarda geçen süre" padded={false}>
          <div className={tableCls.wrap}>
            <table className={tableCls.table}>
              <thead>
                <tr>
                  <th className={tableCls.th}>Aşama</th>
                  <th className={`${tableCls.th} text-right`}>Geçiş</th>
                  <th className={`${tableCls.th} text-right`}>Medyan</th>
                  <th className={`${tableCls.th} text-right`}>Ortalama</th>
                </tr>
              </thead>
              <tbody>
                {stages.map((s) => (
                  <tr key={s.stage} className={tableCls.row}>
                    <td className={tableCls.td}>{STAGE_LABELS[s.stage]}</td>
                    <td className={`${tableCls.td} text-right tabular`}>{s.count}</td>
                    <td className={`${tableCls.td} text-right tabular`}>{dur(s.medianHours)}</td>
                    <td className={`${tableCls.td} text-right tabular text-muted`}>{dur(s.avgHours)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="border-t border-line px-5 py-2 text-xs text-muted">Aralıkta bir aşamaya girilip sonra çıkılan geçişler; hâlâ o aşamada bekleyenler sayılmaz.</p>
        </Card>

        <Card title="Teklifler" padded={false} className="xl:col-span-2">
          {r.quotes.length ? (
            <div className={tableCls.wrap}>
              <table className={tableCls.table}>
                <thead>
                  <tr>
                    <th className={tableCls.th}>Durum</th>
                    <th className={tableCls.th}>Para birimi</th>
                    <th className={`${tableCls.th} text-right`}>Adet</th>
                    <th className={`${tableCls.th} text-right`}>Genel toplam</th>
                  </tr>
                </thead>
                <tbody>
                  {r.quotes.map((q) => (
                    <tr key={q.status + q.currency} className={tableCls.row}>
                      <td className={tableCls.td}>{QUOTE_STATUS_LABELS[q.status]}</td>
                      <td className={`${tableCls.td} text-xs`}>{q.currency}</td>
                      <td className={`${tableCls.td} text-right tabular`}>{q.count}</td>
                      <td className={`${tableCls.td} text-right font-medium tabular`}>{formatAmount(q.total, q.currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState title="Bu aralıkta teklif yok" />
          )}
          <p className="border-t border-line px-5 py-2 text-xs text-muted">
            Aralıkta oluşturulan teklifler (revize sürümler ayrı sayılır). Müşteri kabul oranı: {pct(accepted, decidedCount)} ({accepted} / {decidedCount} yanıtlanan).
          </p>
        </Card>
      </div>
    </>
  );
}
