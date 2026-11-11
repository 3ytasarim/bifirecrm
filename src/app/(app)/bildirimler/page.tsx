import Link from "next/link";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { getActorOrNull, requireActor } from "@/lib/rbac/guard";
import { fmtDateTime, fmtRelative } from "@/lib/format";
import { Card, EmptyState, PageHeader } from "@/components/ui/primitives";
import { buttonClass } from "@/components/ui/styles";

export const metadata = { title: "Bildirimler" };

async function markAllRead() {
  "use server";
  const actor = await getActorOrNull();
  if (!actor) return;
  await prisma.internalNotification.updateMany({ where: { userId: actor.id, readAt: null }, data: { readAt: new Date() } });
  revalidatePath("/", "layout");
}

async function openNotification(fd: FormData) {
  "use server";
  const actor = await getActorOrNull();
  if (!actor) return;
  const n = await prisma.internalNotification.findFirst({ where: { id: String(fd.get("id")), userId: actor.id } });
  if (!n) return;
  if (!n.readAt) await prisma.internalNotification.update({ where: { id: n.id }, data: { readAt: new Date() } });
  const { redirect } = await import("next/navigation");
  // Yalnız uygulama içi göreli bağlantılar (açık yönlendirme yok).
  redirect(n.link && n.link.startsWith("/") && !n.link.startsWith("//") ? n.link : "/bildirimler");
}

export default async function NotificationsPage() {
  const actor = await requireActor();
  const rows = await prisma.internalNotification.findMany({ where: { userId: actor.id }, orderBy: { createdAt: "desc" }, take: 100 });
  const unread = rows.filter((r) => !r.readAt).length;
  return (
    <>
      <PageHeader
        title="Bildirim merkezi"
        description="Size atanan işler, hatırlatmalar, geciken görevler ve eskalasyonlar. Bu bildirimler yalnız ekip içidir; müşteriye gönderilmez."
        actions={
          unread ? (
            <form action={markAllRead}>
              <button className={buttonClass("secondary")}>Tümünü okundu say</button>
            </form>
          ) : null
        }
      />
      <Card padded={false}>
        {rows.length ? (
          <ul className="divide-y divide-line">
            {rows.map((n) => (
              <li key={n.id}>
                <form action={openNotification}>
                  <input type="hidden" name="id" value={n.id} />
                  <button className={`flex w-full items-start gap-3 px-5 py-3 text-left hover:bg-surface-2/50 ${n.readAt ? "" : "bg-accent-soft/30"}`}>
                    <span className={`mt-1.5 size-2 shrink-0 rounded-full ${n.readAt ? "bg-transparent" : n.type.includes("overdue") || n.type.includes("escalation") ? "bg-danger" : "bg-accent"}`} aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span className={`block text-sm ${n.readAt ? "" : "font-medium"}`}>{n.title}</span>
                      {n.body ? <span className="block text-xs text-muted">{n.body}</span> : null}
                    </span>
                    <time className="shrink-0 text-xs text-muted" title={fmtDateTime(n.createdAt)}>
                      {fmtRelative(n.createdAt)}
                    </time>
                  </button>
                </form>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title="Bildirim yok" description="Size iş atandığında veya görev geciktiğinde burada görünür." action={<Link href="/gorevler" className={buttonClass("secondary")}>Görevlerim</Link>} />
        )}
      </Card>
    </>
  );
}
