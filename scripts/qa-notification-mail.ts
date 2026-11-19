/**
 * QA (yalnız geliştirme DB'si): bildirimlerin e-posta kopyası — yerel sahte SMTP sunucusuyla, gerçek e-posta GÖNDERMEDEN.
 * Yalnız kendi açtığı QA kullanıcılarının (@example.test) bildirimlerine dokunur ve sonunda onları siler.
 *
 *   npx tsx --conditions=react-server scripts/qa-notification-mail.ts
 */
import { createServer, type Socket } from "node:net";
import type { AddressInfo } from "node:net";

type Mail = { from: string; to: string[]; data: string };
const mails: Mail[] = [];
let failMode = false;
const COPY = "qa-kopya@example.test";

// En basit SMTP sunucusu: EHLO/MAIL/RCPT/DATA/QUIT. STARTTLS/AUTH sunmaz.
const smtp = createServer((sock: Socket) => {
  let cur: Mail = { from: "", to: [], data: "" };
  let inData = false;
  let buf = "";
  sock.write("220 qa-smtp hazir\r\n");
  sock.on("data", (chunk) => {
    buf += chunk.toString("utf8");
    let i: number;
    while ((i = buf.indexOf("\r\n")) >= 0) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 2);
      if (inData) {
        if (line === ".") {
          inData = false;
          if (failMode) sock.write("451 gecici hata\r\n");
          else {
            mails.push(cur);
            sock.write("250 kabul\r\n");
          }
          cur = { from: "", to: [], data: "" };
        } else cur.data += (line.startsWith("..") ? line.slice(1) : line) + "\n";
        continue;
      }
      const cmd = line.slice(0, 4).toUpperCase();
      if (cmd === "EHLO" || cmd === "HELO") sock.write("250 qa-smtp\r\n");
      else if (cmd === "MAIL") {
        cur.from = line;
        sock.write("250 tamam\r\n");
      } else if (cmd === "RCPT") {
        cur.to.push(/<([^>]+)>/.exec(line)?.[1] ?? "");
        sock.write("250 tamam\r\n");
      } else if (cmd === "DATA") {
        inData = true;
        sock.write("354 devam\r\n");
      } else if (cmd === "QUIT") {
        sock.write("221 gule gule\r\n");
        sock.end();
      } else sock.write("250 tamam\r\n");
    }
  });
});

/** Gövdeyi çözer (nodemailer Türkçe metni base64 ya da quoted-printable kodlar). */
function decodeBody(raw: string): string {
  const [head, ...rest] = raw.split("\n\n");
  const body = rest.join("\n\n");
  const enc = /Content-Transfer-Encoding:\s*(\S+)/i.exec(head)?.[1]?.toLowerCase();
  if (enc === "base64") return Buffer.from(body.replace(/\s+/g, ""), "base64").toString("utf8");
  if (enc === "quoted-printable") return Buffer.from(body.replace(/=\n/g, "").replace(/=([0-9A-F]{2})/gi, (_, h: string) => String.fromCharCode(parseInt(h, 16))), "latin1").toString("utf8");
  return body;
}

/** Çok parçalı e-postanın tüm parçalarını çözer (düz metin + HTML). */
function decodeAll(raw: string): string {
  const b = /boundary="?([^";\n]+)"?/i.exec(raw)?.[1];
  if (!b) return decodeBody(raw);
  return raw.split("--" + b).slice(1).map((part) => decodeBody(part.replace(/^\n/, ""))).join("\n");
}

let fails = 0;
const ok = (cond: unknown, msg: string) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`);
  if (!cond) fails++;
};

async function main() {
  await new Promise<void>((r) => smtp.listen(0, "127.0.0.1", () => r()));
  const port = (smtp.address() as AddressInfo).port;
  Object.assign(process.env, { SMTP_URL: `smtp://127.0.0.1:${port}`, SMTP_FROM: "Bifire CRM <crm@example.test>", NOTIFY_EMAIL_COPY_TO: COPY });
  await import("dotenv/config");
  if (process.env.APP_ENV === "production") throw new Error("production'da çalışmaz");

  const { prisma } = await import("@/lib/db");
  const { sendPendingNotificationEmails } = await import("@/lib/jobs/notification-mail");
  const { notify } = await import("@/lib/notifications");

  const mk = (email: string, name: string, emailNotifications: boolean) =>
    prisma.user.upsert({ where: { email }, create: { email, name, role: "SALES", status: "ACTIVE", emailNotifications }, update: { emailNotifications, status: "ACTIVE" } });
  const on = await mk("qa-mail-acik@example.test", "QA Satış", true);
  const off = await mk("qa-mail-kapali@example.test", "QA Kapalı", false);
  const ids = [on.id, off.id];
  let contactId: string | null = null;
  let taskId: string | null = null;
  const run = (now?: Date) => sendPendingNotificationEmails(now ?? new Date(), { onlyUserIds: ids });

  try {
    // Bildirimler: yeni talep, hatırlatma, e-postalanmayan tür, 7 saat önceki eski bildirim, kapalı kullanıcı.
    await notify({ userId: on.id, type: "lead", title: "Yeni talep: QA Müşteri", body: "Web sitesi · seçim rehberi", link: "/firsatlar/qa-1" });
    await notify({ userId: on.id, type: "task_reminder", title: "Hatırlatma: QA keşif araması", link: "/gorevler?id=qa-2" });
    await notify({ userId: on.id, type: "stage", title: "QA aşama değişti" });
    const old = await prisma.internalNotification.create({ data: { userId: on.id, type: "lead", title: "QA eski talep", createdAt: new Date(Date.now() - 7 * 3600_000) } });
    await notify({ userId: off.id, type: "lead", title: "Yeni talep: QA Kapalı" });

    const to = (addr: string) => mails.filter((m) => m.to.includes(addr));
    const r1 = await run();
    ok(r1.sent === 2 && r1.copies === 3 && r1.skipped === 0 && !r1.error, `ilk tur: kişiye 2, kopya 3 (${JSON.stringify(r1)})`);
    ok(to(on.email).length === 2 && to(off.email).length === 0, "kişiye: açık kullanıcıya 2, kapalı kullanıcıya 0");
    ok(to(COPY).length === 3 && mails.every((m) => m.to.length === 1), "kopya adresine her olay için 1 e-posta (kapalı kullanıcınınki dahil)");
    const lead = mails.find((m) => /Yeni talep/.test(m.data));
    ok(lead && /^Subject: /m.test(lead.data), "konu satırı var");
    ok(lead && /multipart\/alternative/i.test(lead.data) && /text\/html/i.test(lead.data), "HTML + düz metin birlikte gönderildi");
    const body = to(on.email).map((m) => decodeAll(m.data)).join("\n");
    ok(/https?:\/\/\S+\/firsatlar\/qa-1/.test(body) && /\/gorevler\?id=qa-2/.test(body) && /Merhaba QA Satış/.test(body), "e-postada ad + CRM bağlantısı var");
    const copyBody = to(COPY).map((m) => decodeAll(m.data)).join("\n");
    ok(/Bilgi kopyası: bildirim QA Satış/.test(copyBody) && /Bilgi kopyası: bildirim QA Kapalı/.test(copyBody), "kopyada asıl alıcı belirtilmiş");
    ok(!/QA aşama değişti/.test(body + copyBody), "e-posta türü olmayan bildirim gönderilmedi");
    ok(!(await prisma.internalNotification.findUnique({ where: { id: old.id } }))?.emailedAt && !/QA eski talep/.test(body + copyBody), "6 saatten eski bildirim gönderilmedi");

    const r2 = await run();
    ok(r2.sent === 0 && r2.copies === 0 && mails.length === 5, "ikinci tur: tekrar gönderim yok");

    // Aynı olay iki kişiye bildirildi → her kişiye kendi e-postası, kopya adresine tek e-posta.
    const before = to(COPY).length;
    await notify({ userId: on.id, type: "lead", title: "Yeni talep: QA Ortak", link: "/firsatlar/qa-9" });
    await notify({ userId: off.id, type: "lead", title: "Yeni talep: QA Ortak", link: "/firsatlar/qa-9" });
    const r5 = await run();
    ok(r5.sent === 1 && r5.copies === 1 && to(COPY).length === before + 1, `ortak olay: kopya tek (${JSON.stringify(r5)})`);

    // Detay: bağlantı gerçek bir göreve gidiyorsa müşteri adı/telefonu/son tarih e-postaya eklenir.
    const contact = await prisma.contact.create({ data: { firstName: "QA Detay", fullName: "QA Detay Müşteri", primaryPhone: "+905000000001", primaryEmail: "qa-detay@example.test" } });
    contactId = contact.id;
    const task = await prisma.task.create({ data: { title: "QA ilk dönüş", description: "QA görev notu", dueAt: new Date(Date.now() + 3600_000), priority: "HIGH", contactId: contact.id, assigneeId: on.id } });
    taskId = task.id;
    const n6 = mails.length;
    await notify({ userId: on.id, type: "task_reminder", title: "Hatırlatma: QA ilk dönüş", link: `/gorevler?id=${task.id}` });
    const r6 = await run();
    const det = mails.slice(n6).map((m) => decodeAll(m.data)).join("\n");
    ok(r6.sent === 1 && /QA Detay Müşteri/.test(det) && /\+90 500 000 00 01/.test(det) && /tel:\+905000000001/.test(det) && /wa\.me\/905000000001/.test(det), "detay: müşteri, telefon, Ara + WhatsApp düğmesi");
    ok(/QA görev notu/.test(det) && /Yüksek/.test(det) && /Son tarih/.test(det), "detay: görev notu, öncelik, son tarih");

    // SMTP geçici hatası: bildirim işaretlenmez, sonraki turda gider.
    failMode = true;
    const n0 = mails.length;
    await notify({ userId: on.id, type: "message", title: "Yeni WhatsApp mesajı: QA Müşteri", link: "/mesajlar/qa-3" });
    const r3 = await run();
    ok(r3.sent === 0 && r3.error, `SMTP hatası raporlandı (${r3.error})`);
    failMode = false;
    const r4 = await run();
    ok(r4.sent === 1 && r4.copies === 1 && mails.length === n0 + 2, "hata sonrası bir sonraki turda gönderildi (kişi + kopya)");
  } finally {
    if (taskId) await prisma.task.delete({ where: { id: taskId } });
    if (contactId) await prisma.contact.deleteMany({ where: { id: contactId, primaryEmail: { endsWith: "@example.test" } } });
    await prisma.internalNotification.deleteMany({ where: { userId: { in: ids } } });
    await prisma.user.deleteMany({ where: { id: { in: ids }, email: { endsWith: "@example.test" } } });
    await prisma.$disconnect();
    smtp.close();
  }
  console.log(fails ? `\n${fails} FAIL` : "\nTümü PASS");
  process.exit(fails ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
