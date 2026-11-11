"use client";

import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { ActionForm, Field, inputClass, SubmitButton, TextareaField } from "@/components/ui/form";
import { buttonClass } from "@/components/ui/styles";
import { calcItem, calcQuote, formatAmount, formatPct, fromScaled } from "@/lib/quotes/calc";
import { saveQuoteAction } from "./actions";

export type EditorItem = { key: string; description: string; quantity: string; unit: string; unitPrice: string; discountPct: string; taxPct: string };

const newKey = () => Math.random().toString(36).slice(2);
const blank = (): EditorItem => ({ key: newKey(), description: "", quantity: "1", unit: "adet", unitPrice: "", discountPct: "0", taxPct: "20" });

/**
 * Taslak teklif kalem düzenleyicisi. Toplamlar sunucudakiyle AYNI fonksiyonla (calcQuote) canlı hesaplanır;
 * kayıtta sunucu yeniden hesaplar (istemci toplamına güvenilmez).
 */
export function QuoteEditor({
  id,
  initial,
  currency: initialCurrency,
  validUntil,
  notes,
  terms,
  units,
  taxRates,
}: {
  id: string;
  initial: EditorItem[];
  currency: string;
  validUntil: string;
  notes: string;
  terms: string;
  units: readonly string[];
  taxRates: readonly string[];
}) {
  const [items, setItems] = useState<EditorItem[]>(initial.length ? initial : [blank()]);
  const [currency, setCurrency] = useState(initialCurrency);

  const view = useMemo(() => {
    const rows = items.map((i) => {
      try {
        const r = calcItem({ quantity: i.quantity || "0", unitPrice: i.unitPrice || "0", discountPct: i.discountPct || "0", taxPct: i.taxPct || "0" });
        return { net: fromScaled(r.net, 2), error: null as string | null };
      } catch (e) {
        return { net: null, error: e instanceof Error ? e.message : "Geçersiz" };
      }
    });
    let totals: ReturnType<typeof calcQuote> | null = null;
    if (rows.every((r) => !r.error)) {
      try {
        totals = calcQuote(items.map((i) => ({ quantity: i.quantity || "0", unitPrice: i.unitPrice || "0", discountPct: i.discountPct || "0", taxPct: i.taxPct || "0" })));
      } catch {
        totals = null;
      }
    }
    return { rows, totals };
  }, [items]);

  const update = (key: string, patch: Partial<EditorItem>) => setItems((xs) => xs.map((x) => (x.key === key ? { ...x, ...patch } : x)));
  const move = (idx: number, dir: -1 | 1) =>
    setItems((xs) => {
      const j = idx + dir;
      if (j < 0 || j >= xs.length) return xs;
      const copy = [...xs];
      [copy[idx], copy[j]] = [copy[j], copy[idx]];
      return copy;
    });
  const payload = JSON.stringify(items.filter((i) => i.description.trim() || i.unitPrice.trim()).map(({ key: _k, ...rest }) => (void _k, rest)));

  return (
    <ActionForm action={saveQuoteAction} className="space-y-5">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="items" value={payload} />
      <div className="grid gap-4 sm:grid-cols-3">
        <Field name="validUntil" label="Geçerlilik tarihi" type="date" defaultValue={validUntil} required />
        <Field name="currency" label="Para birimi">
          <select id="f-currency" name="currency" value={currency} onChange={(e) => setCurrency(e.target.value)} className={inputClass(false)}>
            <option value="TRY">TRY (₺)</option>
            <option value="EUR">EUR (€)</option>
            <option value="USD">USD ($)</option>
          </select>
        </Field>
      </div>

      <div className="overflow-x-auto rounded-lg border border-line">
        <table className="w-full min-w-[860px] text-sm">
          <thead className="bg-surface-2 text-left text-xs text-muted">
            <tr>
              <th className="w-8 px-2 py-2">#</th>
              <th className="px-2 py-2">Açıklama</th>
              <th className="w-24 px-2 py-2 text-right">Miktar</th>
              <th className="w-24 px-2 py-2">Birim</th>
              <th className="w-32 px-2 py-2 text-right">Birim fiyat</th>
              <th className="w-20 px-2 py-2 text-right">İsk. %</th>
              <th className="w-20 px-2 py-2 text-right">KDV</th>
              <th className="w-32 px-2 py-2 text-right">Tutar (KDV hariç)</th>
              <th className="w-20 px-2 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {items.map((it, idx) => {
              const row = view.rows[idx];
              return (
                <tr key={it.key} className="border-t border-line align-top">
                  <td className="px-2 py-2 pt-4 text-xs tabular text-muted">{idx + 1}</td>
                  <td className="px-2 py-2">
                    <textarea aria-label={`${idx + 1}. kalem açıklaması`} rows={2} value={it.description} onChange={(e) => update(it.key, { description: e.target.value })} className={inputClass(false)} placeholder="ör. L tipi odunlu şömine, 120 cm, sağ cam" />
                  </td>
                  <td className="px-2 py-2">
                    <input aria-label="Miktar" inputMode="decimal" value={it.quantity} onChange={(e) => update(it.key, { quantity: e.target.value })} className={`${inputClass(false)} text-right`} />
                  </td>
                  <td className="px-2 py-2">
                    <select aria-label="Birim" value={it.unit} onChange={(e) => update(it.key, { unit: e.target.value })} className={inputClass(false)}>
                      {units.map((u) => (
                        <option key={u}>{u}</option>
                      ))}
                    </select>
                  </td>
                  <td className="px-2 py-2">
                    <input aria-label="Birim fiyat" inputMode="decimal" value={it.unitPrice} onChange={(e) => update(it.key, { unitPrice: e.target.value })} className={`${inputClass(!!row?.error && !!it.unitPrice)} text-right`} placeholder="0,00" />
                  </td>
                  <td className="px-2 py-2">
                    <input aria-label="İskonto yüzdesi" inputMode="decimal" value={it.discountPct} onChange={(e) => update(it.key, { discountPct: e.target.value })} className={`${inputClass(false)} text-right`} />
                  </td>
                  <td className="px-2 py-2">
                    <select aria-label="KDV oranı" value={it.taxPct} onChange={(e) => update(it.key, { taxPct: e.target.value })} className={inputClass(false)}>
                      {taxRates.map((r) => (
                        <option key={r} value={r}>
                          %{r}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-2 py-2 pt-4 text-right font-medium tabular">{row?.error ? <span className="text-xs text-danger">{row.error}</span> : row?.net ? formatAmount(row.net, currency) : "—"}</td>
                  <td className="px-2 py-2">
                    <div className="flex items-center justify-end gap-0.5 pt-1.5">
                      <button type="button" aria-label="Yukarı taşı" onClick={() => move(idx, -1)} disabled={idx === 0} className="rounded p-1.5 text-muted hover:bg-surface-2 disabled:opacity-30">
                        <ArrowUp className="size-3.5" />
                      </button>
                      <button type="button" aria-label="Aşağı taşı" onClick={() => move(idx, 1)} disabled={idx === items.length - 1} className="rounded p-1.5 text-muted hover:bg-surface-2 disabled:opacity-30">
                        <ArrowDown className="size-3.5" />
                      </button>
                      <button type="button" aria-label="Kalemi sil" onClick={() => setItems((xs) => (xs.length > 1 ? xs.filter((x) => x.key !== it.key) : [blank()]))} className="rounded p-1.5 text-danger hover:bg-danger-soft">
                        <Trash2 className="size-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <button type="button" onClick={() => setItems((xs) => [...xs, blank()])} className={buttonClass("secondary", "sm")}>
        <Plus className="size-4" aria-hidden /> Kalem ekle
      </button>

      <div className="ml-auto max-w-sm space-y-1.5 rounded-lg bg-surface-2/60 p-4 text-sm" aria-live="polite">
        {view.totals ? (
          <>
            <Row label="Ara toplam" value={formatAmount(view.totals.subtotal, currency)} />
            {Number(view.totals.discountTotal) ? <Row label="İskonto" value={"−" + formatAmount(view.totals.discountTotal, currency)} /> : null}
            {view.totals.taxBreakdown.map((t) => (
              <Row key={t.rate} label={`KDV ${formatPct(t.rate)}`} value={formatAmount(t.tax, currency)} />
            ))}
            <div className="flex justify-between border-t border-line pt-2 text-base font-semibold">
              <span>Genel toplam</span>
              <span className="tabular">{formatAmount(view.totals.grandTotal, currency)}</span>
            </div>
          </>
        ) : (
          <p className="text-danger">Hatalı değerleri düzeltin; toplam hesaplanamıyor.</p>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <TextareaField name="notes" label="Notlar (PDF'te görünür)" rows={3} defaultValue={notes} />
        <TextareaField name="terms" label="Teklif şartları (PDF'te görünür)" rows={3} defaultValue={terms} hint="Varsayılan metin Ayarlar › Teklif bilgileri'nden gelir." />
      </div>
      <SubmitButton>Taslağı kaydet</SubmitButton>
    </ActionForm>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-muted">
      <span>{label}</span>
      <span className="tabular text-fg">{value}</span>
    </div>
  );
}
