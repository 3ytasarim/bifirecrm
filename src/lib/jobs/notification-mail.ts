import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { mailConfigured, sendInternalMail } from "@/lib/mailer";
import { loadMailDetails, type MailDetails } from "@/lib/jobs/notification-details";
import { notificationMail } from "@/lib/jobs/notification-mail-template";

export { notificationMail };

/**
 * İç bildirimlerin e-posta kopyası (worker, dakikada bir). Müşteriye değil, ilgili ÇALIŞANA gider.
 *  - Yalnız SMTP_URL + SMTP_FROM tanımlıysa çalışır.
 *  - Kullanıcı Ayarlar'dan e-posta bildirimini kapattıysa (emailNotifications=false) ona gönderilmez.
 *  - NOTIFY_EMAIL_COPY_TO tanımlıysa her olayın bir kopyası o adres(ler)e de gider (olay başına tek kopya).
 *  - Bildirim başına bir kez (emailedAt). Son 6 saatten eski bildirim e-postalanmaz (SMTP sonradan açılınca yığın gitmesin).
 *  - SMTP hatasında tur durur; bildirimler bir sonraki turda yeniden denenir.
 */
export const EMAIL_TYPES = ["lead", "message", "assignment", "appointment", "task", "task_reminder", "task_overdue", "task_escalation", "integration_error"] as const;

const MAX_AGE_MS = 6 * 3600_000;
const BATCH = 25;
const SIBLING_WINDOW_MS = 10 * 60_000;

/**
 * `onlyUserIds`: yalnız QA betiği için (gerçek bildirimlere dokunmasın).
 * Kopya: aynı olay birden çok kişiye bildirildiyse (aynı tür + başlık + bağlantı, ±10 dk) kopya yalnız ilkinde gider.
 * Kopya alıcısı aynı zamanda bildirimin sahibiyse ikinci e-posta gitmez.
 */
export async function sendPendingNotificationEmails(now = new Date(), opts: { onlyUserIds?: string[] } = {}): Promise<{ sent: number; copies: number; skipped: number; error?: string }> {
  if (!mailConfigured()) return { sent: 0, copies: 0, skipped: 0 };
  const e = env();
  const copyTo = e.NOTIFY_EMAIL_COPY_TO;
  const pending = await prisma.internalNotification.findMany({
    where: {
      emailedAt: null,
      type: { in: [...EMAIL_TYPES] },
      createdAt: { gte: new Date(now.getTime() - MAX_AGE_MS) },
      ...(opts.onlyUserIds ? { userId: { in: opts.onlyUserIds } } : {}),
    },
    orderBy: { createdAt: "asc" },
    take: BATCH,
    select: { id: true, type: true, title: true, body: true, link: true, createdAt: true, user: { select: { email: true, name: true, status: true, emailNotifications: true } } },
  });
  let sent = 0;
  let copies = 0;
  let skipped = 0;
  // Aynı kayda giden bildirimler (kişi + kopya, birden çok kişi) detayı bir kez yükler.
  const detailCache = new Map<string, Promise<MailDetails | null>>();
  const details = (link: string | null) => {
    if (!link) return Promise.resolve(null);
    if (!detailCache.has(link)) detailCache.set(link, loadMailDetails(link, now));
    return detailCache.get(link)!;
  };
  for (const n of pending) {
    const toUser = n.user.status === "ACTIVE" && n.user.emailNotifications;
    let copyRecipients: string[] = [];
    if (copyTo.length) {
      // Aynı olayın başka bir kişiye giden bildirimi zaten işlendiyse kopya o sırada gitmiştir.
      const sibling = await prisma.internalNotification.findFirst({
        where: {
          id: { not: n.id },
          type: n.type,
          title: n.title,
          link: n.link,
          emailedAt: { not: null },
          createdAt: { gte: new Date(n.createdAt.getTime() - SIBLING_WINDOW_MS), lte: new Date(n.createdAt.getTime() + SIBLING_WINDOW_MS) },
        },
        select: { id: true },
      });
      if (!sibling) copyRecipients = copyTo.filter((a) => !(toUser && a === n.user.email.toLowerCase()));
    }
    try {
      const d = toUser || copyRecipients.length ? await details(n.link) : null;
      if (toUser) {
        const m = notificationMail(n, { appUrl: e.APP_URL, userName: n.user.name, details: d });
        await sendInternalMail(n.user.email, m.subject, m.text, m.html);
        sent++;
      }
      if (copyRecipients.length) {
        const m = notificationMail(n, { appUrl: e.APP_URL, forName: n.user.name, details: d });
        await sendInternalMail(copyRecipients.join(", "), m.subject, m.text, m.html);
        copies++;
      }
    } catch (err) {
      // Alıcı/içerik loglanmaz; bildirim işaretlenmez → sonraki turda yeniden denenir.
      return { sent, copies, skipped, error: err instanceof Error ? err.message.slice(0, 200) : "SMTP hatası" };
    }
    if (!toUser && !copyRecipients.length) skipped++;
    // Gönderilmeyenler de işaretlenir ki her turda yeniden taranmasın.
    await prisma.internalNotification.update({ where: { id: n.id }, data: { emailedAt: new Date() } });
  }
  return { sent, copies, skipped };
}
