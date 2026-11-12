import Link from "next/link";
import type { MessageChannel, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/rbac/guard";
import { conversationScope } from "@/lib/rbac/scope";
import { MESSAGE_CHANNEL_LABELS } from "@/lib/labels";
import { fmtRelative } from "@/lib/format";
import { formatPhone } from "@/lib/normalize";
import { hrefWith } from "@/lib/queries";
import { Badge, EmptyState, PageHeader } from "@/components/ui/primitives";
import { buttonClass } from "@/components/ui/styles";

export const metadata = { title: "Mesajlar" };

type SP = { kanal?: string; filtre?: string };

export default async function InboxPage({ searchParams }: { searchParams: Promise<SP> }) {
  const actor = await requirePermission("messages.view");
  const sp = await searchParams;
  const channel = sp.kanal === "WHATSAPP" || sp.kanal === "INSTAGRAM" ? (sp.kanal as MessageChannel) : undefined;
  const where: Prisma.ConversationWhereInput = {
    AND: [
      conversationScope(actor),
      channel ? { channel } : {},
      sp.filtre === "okunmamis" ? { unreadCount: { gt: 0 } } : {},
      sp.filtre === "bana" ? { assignedUserId: actor.id } : {},
      sp.filtre === "eslesmemis" ? { contactId: null } : {},
    ],
  };
  const rows = await prisma.conversation.findMany({
    where,
    orderBy: [{ lastMessageAt: { sort: "desc", nulls: "last" } }],
    take: 100,
    select: {
      id: true,
      channel: true,
      displayName: true,
      phone: true,
      externalThreadId: true,
      unreadCount: true,
      lastMessageAt: true,
      contact: { select: { fullName: true } },
      messages: { orderBy: { occurredAt: "desc" }, take: 1, select: { body: true, direction: true } },
    },
  });
  const path = "/mesajlar";
  const chip = (label: string, patch: Partial<SP>, active: boolean) => (
    <Link href={hrefWith(path, sp, patch)} className={buttonClass(active ? "primary" : "secondary", "sm")} aria-current={active ? "page" : undefined}>
      {label}
    </Link>
  );

  return (
    <>
      <PageHeader title="Mesajlar" description="WhatsApp ve Instagram'dan gelen yazışmalar. WhatsApp'a yalnız Meta onaylı şablonla yazılır; Instagram yanıtları Instagram uygulamasından verilir." />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {chip("Tümü", { kanal: undefined }, !channel)}
        {chip("WhatsApp", { kanal: "WHATSAPP" }, channel === "WHATSAPP")}
        {chip("Instagram", { kanal: "INSTAGRAM" }, channel === "INSTAGRAM")}
        <span className="mx-1 h-5 w-px bg-line" aria-hidden />
        {chip("Hepsi", { filtre: undefined }, !sp.filtre)}
        {chip("Okunmamış", { filtre: "okunmamis" }, sp.filtre === "okunmamis")}
        {chip("Bana atanan", { filtre: "bana" }, sp.filtre === "bana")}
        {chip("Müşteriye bağlanmamış", { filtre: "eslesmemis" }, sp.filtre === "eslesmemis")}
      </div>
      {rows.length ? (
        <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface shadow-card">
          {rows.map((c) => {
            const name = c.contact?.fullName ?? c.displayName ?? (c.phone ? formatPhone(c.phone) : `${MESSAGE_CHANNEL_LABELS[c.channel]} kullanıcısı`);
            const last = c.messages[0];
            return (
              <li key={c.id}>
                <Link href={`/mesajlar/${c.id}`} className="flex items-start justify-between gap-3 px-5 py-3.5 hover:bg-surface-2/50">
                  <span className="min-w-0">
                    <span className={`block truncate ${c.unreadCount ? "font-semibold" : "font-medium"}`}>{name}</span>
                    <span className="block truncate text-sm text-muted">
                      {last ? `${last.direction === "OUTBOUND" ? "Siz: " : ""}${last.body ?? ""}` : "—"}
                    </span>
                  </span>
                  <span className="flex shrink-0 flex-col items-end gap-1 text-xs text-muted">
                    <Badge tone={c.channel === "WHATSAPP" ? "success" : "info"}>{MESSAGE_CHANNEL_LABELS[c.channel]}</Badge>
                    {c.lastMessageAt ? fmtRelative(c.lastMessageAt) : null}
                    {!c.contact ? <span className="text-warning">Müşteriye bağlı değil</span> : null}
                    {c.unreadCount ? <Badge tone="warning">{c.unreadCount} yeni</Badge> : null}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      ) : (
        <EmptyState title="Yazışma yok" description="WhatsApp / Instagram bağlantısı kurulup ilk mesaj geldiğinde burada görünür (Entegrasyonlar ekranı)." />
      )}
    </>
  );
}
