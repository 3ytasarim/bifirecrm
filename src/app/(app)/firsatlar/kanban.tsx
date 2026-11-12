"use client";

import Link from "next/link";
import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { DndContext, DragOverlay, KeyboardSensor, PointerSensor, TouchSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent, type DragStartEvent } from "@dnd-kit/core";
import type { OpportunityStage } from "@prisma/client";
import { cn } from "@/components/ui/cn";
import { buttonClass, inputClass } from "@/components/ui/form";
import { moveOpportunityAction } from "./actions";

export type KanbanCard = {
  id: string;
  code: string;
  title: string;
  contact: string;
  owner: string | null;
  amount: string | null;
  source: string;
  nextActionAt: string | null;
  overdue: boolean;
  stage: OpportunityStage;
  position: number;
};

type Column = { stage: OpportunityStage; label: string };

export function Kanban({ columns, initial, lostReasons, canEdit }: { columns: Column[]; initial: KanbanCard[]; lostReasons: string[]; canEdit: boolean }) {
  const [cards, setCards] = useState(initial);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingLost, setPendingLost] = useState<{ id: string; prev: KanbanCard[] } | null>(null);
  const [, startTransition] = useTransition();
  const router = useRouter();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 6 } }),
    useSensor(KeyboardSensor),
  );
  const byStage = useMemo(() => {
    const m = new Map<OpportunityStage, KanbanCard[]>();
    for (const c of columns) m.set(c.stage, []);
    for (const card of [...cards].sort((a, b) => a.position - b.position)) m.get(card.stage)?.push(card);
    return m;
  }, [cards, columns]);

  function persist(id: string, stage: OpportunityStage, prev: KanbanCard[], lost?: { reason: string; note: string }) {
    // Hedef kolonda en üste bırakılır; komşu (afterId) sunucuya iletilir.
    const target = (byStage.get(stage) ?? []).filter((c) => c.id !== id);
    const afterId = target[0]?.id ?? null;
    startTransition(async () => {
      const r = await moveOpportunityAction({ id, stage, beforeId: null, afterId, lostReason: lost?.reason ?? null, lostNote: lost?.note ?? null });
      if (!r.ok) {
        setCards(prev);
        setError(r.message ?? "Kaydedilemedi.");
      } else {
        setError(null);
        router.refresh();
      }
    });
  }

  function onDragEnd(e: DragEndEvent) {
    setActiveId(null);
    const id = String(e.active.id);
    const to = e.over?.id as OpportunityStage | undefined;
    const card = cards.find((c) => c.id === id);
    if (!card || !to || card.stage === to) return;
    const prev = cards;
    const top = Math.min(0, ...(byStage.get(to) ?? []).map((c) => c.position)) - 1000;
    setCards((cs) => cs.map((c) => (c.id === id ? { ...c, stage: to, position: top } : c)));
    if (to === "LOST") {
      setPendingLost({ id, prev });
      return;
    }
    persist(id, to, prev);
  }

  const active = activeId ? cards.find((c) => c.id === activeId) : null;

  return (
    <>
      {error ? (
        <div role="alert" className="mb-3 rounded-lg border border-danger/30 bg-danger-soft px-3.5 py-2.5 text-sm text-danger">
          {error}
        </div>
      ) : null}
      <p className="mb-3 text-xs text-muted">
        {canEdit ? "Kartı sürükleyip başka aşamaya bırakın (klavye: kartta Boşluk → ok tuşları → Boşluk). Değişiklik anında kaydedilir." : "Salt görüntüleme."}
      </p>
      <DndContext sensors={sensors} onDragStart={(e: DragStartEvent) => setActiveId(String(e.active.id))} onDragEnd={onDragEnd} onDragCancel={() => setActiveId(null)}>
        <div className="-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-4 sm:-mx-6 sm:px-6">
          {columns.map((col) => (
            <KanbanColumn key={col.stage} column={col} cards={byStage.get(col.stage) ?? []} canEdit={canEdit} />
          ))}
        </div>
        <DragOverlay>{active ? <CardView card={active} dragging /> : null}</DragOverlay>
      </DndContext>
      {pendingLost ? (
        <LostDialog
          reasons={lostReasons}
          onCancel={() => {
            setCards(pendingLost.prev);
            setPendingLost(null);
          }}
          onConfirm={(reason, note) => {
            persist(pendingLost.id, "LOST", pendingLost.prev, { reason, note });
            setPendingLost(null);
          }}
        />
      ) : null}
    </>
  );
}

function KanbanColumn({ column, cards, canEdit }: { column: Column; cards: KanbanCard[]; canEdit: boolean }) {
  const { setNodeRef, isOver } = useDroppable({ id: column.stage, disabled: !canEdit });
  return (
    <section
      ref={setNodeRef}
      aria-label={`${column.label} (${cards.length})`}
      className={cn(
        "flex w-[280px] shrink-0 snap-start flex-col rounded-xl border bg-surface-2/60 transition-colors",
        isOver ? "border-accent bg-accent-soft/60" : "border-line",
        column.stage === "WON" && "bg-success-soft/40",
        column.stage === "LOST" && "bg-danger-soft/30",
      )}
    >
      <header className="flex items-center justify-between px-3 py-2.5">
        <h2 className="text-[13px] font-semibold">{column.label}</h2>
        <span className="rounded-full bg-surface px-2 text-xs tabular text-muted">{cards.length}</span>
      </header>
      <div className="flex min-h-24 flex-1 flex-col gap-2 px-2 pb-2">
        {cards.map((c) => (
          <DraggableCard key={c.id} card={c} canEdit={canEdit} />
        ))}
      </div>
    </section>
  );
}

function DraggableCard({ card, canEdit }: { card: KanbanCard; canEdit: boolean }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: card.id, disabled: !canEdit });
  return (
    <div ref={setNodeRef} {...listeners} {...attributes} aria-roledescription="sürüklenebilir fırsat kartı" className={cn("touch-manipulation", isDragging && "opacity-30")}>
      <CardView card={card} />
    </div>
  );
}

function CardView({ card, dragging }: { card: KanbanCard; dragging?: boolean }) {
  return (
    <article className={cn("rounded-lg border border-line bg-surface p-3 text-sm shadow-card", dragging ? "rotate-1 cursor-grabbing shadow-lg" : "cursor-grab")}>
      <div className="mb-1 flex items-center justify-between gap-2 text-[11px] text-muted">
        <span className="tabular">{card.code}</span>
        <span className="truncate">{card.source}</span>
      </div>
      <Link href={`/firsatlar/${card.id}`} className="block font-medium leading-snug hover:text-accent-ink hover:underline" onPointerDown={(e) => e.stopPropagation()}>
        {card.contact}
      </Link>
      <p className="mt-0.5 line-clamp-2 text-xs text-muted">{card.title}</p>
      <div className="mt-2 flex items-center justify-between gap-2 text-xs">
        <span className={card.owner ? "text-muted" : "text-danger"}>{card.owner ?? "Sorumlu yok"}</span>
        {card.amount ? <span className="tabular font-medium">{card.amount}</span> : null}
      </div>
      {card.nextActionAt ? <p className={cn("mt-1 text-[11px]", card.overdue ? "font-medium text-danger" : "text-muted")}>Sonraki aksiyon: {card.nextActionAt}</p> : null}
    </article>
  );
}

function LostDialog({ reasons, onCancel, onConfirm }: { reasons: string[]; onCancel: () => void; onConfirm: (reason: string, note: string) => void }) {
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const ref = useRef<HTMLSelectElement>(null);
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-labelledby="lost-title" onKeyDown={(e) => e.key === "Escape" && onCancel()}>
      <div className="w-full max-w-md glass-pop rounded-2xl border border-line bg-[var(--panel)] p-6 shadow-xl">
        <h2 id="lost-title" className="font-display text-lg font-semibold">
          Kayıp nedeni
        </h2>
        <p className="mt-1 text-sm text-muted">Fırsatı “Kaybedildi” aşamasına almak için neden seçin.</p>
        <label htmlFor="lost-reason" className="mt-4 block text-[13px] font-medium">
          Neden
        </label>
        <select id="lost-reason" ref={ref} autoFocus value={reason} onChange={(e) => setReason(e.target.value)} className={cn(inputClass(), "mt-1.5")}>
          <option value="">Seçin…</option>
          {reasons.map((r) => (
            <option key={r}>{r}</option>
          ))}
        </select>
        <label htmlFor="lost-note" className="mt-3 block text-[13px] font-medium">
          Not (isteğe bağlı)
        </label>
        <textarea id="lost-note" rows={3} value={note} onChange={(e) => setNote(e.target.value)} className={cn(inputClass(), "mt-1.5")} />
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onCancel} className={buttonClass("secondary")}>
            Vazgeç
          </button>
          <button type="button" disabled={!reason} onClick={() => onConfirm(reason, note)} className={cn(buttonClass("danger"), "disabled:opacity-50")}>
            Kaybedildi olarak kaydet
          </button>
        </div>
      </div>
    </div>
  );
}
