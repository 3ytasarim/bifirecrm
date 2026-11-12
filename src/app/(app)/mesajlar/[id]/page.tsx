import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/rbac/guard";
import { conversationScope } from "@/lib/rbac/scope";
import { markConversationRead } from "@/lib/services/channels";
import { whatsappConfig } from "@/lib/integrations/channels-config";
import { MESSAGE_CHANNEL_LABELS, MESSAGE_STATUS_LABELS, WA_TEMPLATE_CATEGORY_LABELS } from "@/lib/labels";
import { fmtDateTime } from "@/lib/format";
import { formatPhone } from "@/lib/normalize";
import { activeUsers } from "@/lib/queries";
import { Badge, Card, DefList, EmptyState, PageHeader } from "@/components/ui/primitives";
import { buttonClass } from "@/components/ui/styles";
import { AssignForm, TemplateSendForm } from "../forms";

export const metadata = { title: "Yazışma" };

export default async function ConversationPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requirePermission("messages.view");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const conv = await prisma.conversation.findFirst({
    where: { id, ...conversationScope(actor) },
    include: {
      contact: { select: { id: true, fullName: true, primaryPhone: true } },
      lead: { select: { id: true, status: true } },
      messages: { orderBy: { occurredAt: "asc" }, take: 300 },
    },
  });
  if (!conv) notFound();
  if (conv.unreadCount > 0) await markConversationRead(actor, conv.id);

  const canSend = actor.perms.has("messages.send");
  const waReady = canSend && conv.channel === "WHATSAPP" && Boolean(whatsappConfig());
  const [templates, users] = await Promise.all([
    waReady ? prisma.whatsappTemplate.findMany({ where: { status: "APPROVED", paramCount: { gte: 0 } }, orderBy: { name: "asc" } }) : Promise.resolve([]),
    canSend ? activeUsers() : Promise.resolve([]),
  ]);
  const name = conv.contact?.fullName ?? conv.displayName ?? (conv.phone ? formatPhone(conv.phone) : `${MESSAGE_CHANNEL_LABELS[conv.channel]} kullanıcısı`);
  const lastInbound = conv.lastInboundAt;

  return (
    <>
      <PageHeader title={name} description={`${MESSAGE_CHANNEL_LABELS[conv.channel]} yazışması`} back={{ href: "/mesajlar", label: "Mesajlar" }} />
      <div className="grid gap-6 xl:grid-cols-[1fr_340px]">
        <Card title={`Mesajlar (${conv.messages.length})`}>
          {conv.messages.length ? (
            <ol className="space-y-3" aria-label="Mesaj geçmişi">
              {conv.messages.map((m) => {
                const out = m.direction === "OUTBOUND";
                return (
                  <li key={m.id} className={`flex ${out ? "justify-end" : "justify-start"}`}>
                    <div className={`max-w-[85%] rounded-xl border px-3.5 py-2.5 text-sm ${out ? "border-accent/30 bg-accent-soft" : "border-line bg-surface-2/60"}`}>
                      <p className="whitespace-pre-wrap break-words">{m.body ?? "—"}</p>
                      <p className="mt-1 text-right text-[11px] text-muted">
                        {fmtDateTime(m.occurredAt)}
                        {out ? ` · ${MESSAGE_STATUS_LABELS[m.status]}` : ""}
                        {m.type === "template" ? " · şablon" : ""}
                      </p>
                      {m.status === "FAILED" && m.error ? <p className="mt-1 text-xs text-danger">{m.error}</p> : null}
                    </div>
                  </li>
                );
              })}
            </ol>
          ) : (
            <EmptyState title="Henüz mesaj yok" />
          )}
        </Card>

        <div className="space-y-6">
          <Card title="Kişi">
            <DefList
              items={[
                { label: "Kanal", value: <Badge tone={conv.channel === "WHATSAPP" ? "success" : "info"}>{MESSAGE_CHANNEL_LABELS[conv.channel]}</Badge> },
                { label: "Görünen ad", value: conv.displayName ?? "—" },
                ...(conv.phone ? [{ label: "Numara", value: formatPhone(conv.phone) }] : []),
                { label: "Son gelen mesaj", value: lastInbound ? fmtDateTime(lastInbound) : "—" },
                {
                  label: "Müşteri",
                  value: conv.contact ? (
                    <Link href={`/musteriler/${conv.contact.id}`} className="text-accent-ink underline-offset-2 hover:underline">
                      {conv.contact.fullName}
                    </Link>
                  ) : (
                    <span className="text-warning">Bağlı değil</span>
                  ),
                },
              ]}
            />
            {!conv.contact && conv.lead?.status === "RECEIVED" && actor.perms.has("leads.process") ? (
              <Link href={`/talepler/yeni?talep=${conv.lead.id}`} className={`${buttonClass("primary", "sm")} mt-4`}>
                Talep olarak işle (müşteriye bağla)
              </Link>
            ) : null}
            {canSend ? (
              <div className="mt-4 border-t border-line pt-4">
                <AssignForm id={conv.id} current={conv.assignedUserId} users={users.map((u) => ({ id: u.id, name: u.name }))} />
              </div>
            ) : null}
          </Card>

          {conv.channel === "WHATSAPP" && canSend ? (
            <Card title="Şablonla yaz">
              {!waReady ? (
                <EmptyState title="WhatsApp bağlantısı yapılandırılmadı" description="Bağlantı kurulup şablonlar Meta'da onaylanınca buradan yazılabilir (Entegrasyonlar)." />
              ) : templates.length ? (
                <TemplateSendForm conversationId={conv.id} templates={templates.map((t) => ({ id: t.id, name: t.name, language: t.language, category: t.category, categoryLabel: WA_TEMPLATE_CATEGORY_LABELS[t.category] ?? t.category, body: t.body, paramCount: t.paramCount }))} />
              ) : (
                <EmptyState title="Onaylı şablon yok" description="Şablonlar Meta'da onaylandıktan sonra Entegrasyonlar › WhatsApp şablonları › senkronize et." />
              )}
            </Card>
          ) : null}
          {conv.channel === "INSTAGRAM" ? (
            <Card title="Yanıt">
              <p className="text-sm text-muted">Instagram yanıtları Instagram uygulamasından (ya da Meta Business Suite&apos;ten) verilir; gönderilen yanıtlar buraya otomatik düşer.</p>
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}
