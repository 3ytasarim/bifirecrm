import type { MailDetails } from "@/lib/jobs/notification-details";

/**
 * Bildirim e-postasının HTML + düz metin hali. E-posta istemcileri (Outlook, Gmail, Apple Mail, webmail) için
 * tablo tabanlı, satır içi stil; harici CSS/JS yok. Logo yüklenmezse alt metni görünür.
 */
/** +905321234567 → +90 532 123 45 67 (diğer biçimler olduğu gibi). */
export function fmtPhone(p: string | null | undefined): string | null {
  if (!p) return null;
  const m = /^\+90(\d{3})(\d{3})(\d{2})(\d{2})$/.exec(p.replace(/\s+/g, ""));
  return m ? `+90 ${m[1]} ${m[2]} ${m[3]} ${m[4]}` : p;
}

export type MailNote = { type: string; title: string; body: string | null; link: string | null };

const C = {
  page: "#f4efe8",
  card: "#ffffff",
  ink: "#26302f",
  muted: "#6b7472",
  line: "#ece5dc",
  accent: "#9a6c42",
  accentSoft: "#f6ebdf",
  red: "#b42318",
  redSoft: "#fdecea",
  green: "#067647",
  greenSoft: "#e7f6ee",
  blue: "#175cd3",
  blueSoft: "#eaf1fd",
};

const KIND: Record<string, { label: string; fg: string; bg: string; intro: string }> = {
  lead: { label: "Yeni talep", fg: C.green, bg: C.greenSoft, intro: "Yeni bir müşteri talebi geldi. Hızlı dönüş satış şansını artırır." },
  message: { label: "Yeni mesaj", fg: C.blue, bg: C.blueSoft, intro: "Bir müşteriden mesaj var." },
  assignment: { label: "Atama", fg: C.accent, bg: C.accentSoft, intro: "Size yeni bir kayıt atandı." },
  appointment: { label: "Randevu", fg: C.accent, bg: C.accentSoft, intro: "Randevu bilgisi güncellendi." },
  task: { label: "Görev", fg: C.accent, bg: C.accentSoft, intro: "Size yeni bir görev atandı." },
  task_reminder: { label: "Hatırlatma", fg: C.accent, bg: C.accentSoft, intro: "Planlanan görevin zamanı geldi." },
  task_overdue: { label: "Geciken görev", fg: C.red, bg: C.redSoft, intro: "Bu görevin son tarihi geçti ve hâlâ açık." },
  task_escalation: { label: "Gecikme uyarısı", fg: C.red, bg: C.redSoft, intro: "Bu görev 24 saati aşkın süredir gecikmede." },
  integration_error: { label: "Bağlantı hatası", fg: C.red, bg: C.redSoft, intro: "Bir entegrasyon hata verdi; mesaj/talep akışı etkilenebilir." },
};
const kindOf = (t: string) => KIND[t] ?? { label: "Bildirim", fg: C.accent, bg: C.accentSoft, intro: "" };

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const nl2br = (s: string) => esc(s).replace(/\r?\n/g, "<br>");
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s);
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

function button(href: string, label: string, primary: boolean) {
  const style = primary
    ? `background:${C.ink};color:#ffffff;border:1px solid ${C.ink};`
    : `background:#ffffff;color:${C.ink};border:1px solid #d9d0c4;`;
  return `<a href="${esc(href)}" target="_blank" style="${style}display:inline-block;margin:0 8px 8px 0;padding:11px 18px;border-radius:10px;font:600 14px/1 ${FONT};text-decoration:none;white-space:nowrap;">${esc(label)}</a>`;
}

export function notificationMail(
  n: MailNote,
  opts: { appUrl: string; userName?: string | null; forName?: string; details?: MailDetails | null },
): { subject: string; text: string; html: string } {
  const base = opts.appUrl.replace(/\/$/, "");
  const url = n.link ? base + (n.link.startsWith("/") ? "" : "/") + n.link : base;
  const k = kindOf(n.type);
  const d = opts.details ?? null;
  const subject = n.title.replace(/[\r\n]+/g, " ").slice(0, 180);
  const greeting = opts.userName ? `Merhaba ${opts.userName},` : "Merhaba,";
  const phone = d?.contact?.phone ?? null;
  const email = d?.contact?.email ?? null;
  const waDigits = phone ? phone.replace(/\D/g, "") : "";

  // ---- Düz metin (HTML göstermeyen istemciler) ----
  const t: string[] = [greeting, "", `[${k.label}] ${n.title}`];
  if (k.intro) t.push(k.intro);
  if (n.body) t.push("", n.body);
  if (d?.rows.length) t.push("", ...d.rows.map(([l, v]) => `${l}: ${v}`));
  if (d?.quote) t.push("", `${d.quote.label}:`, d.quote.text);
  if (d?.messages?.length) t.push("", "Son mesajlar:", ...d.messages.map((m) => `${m.inbound ? "Müşteri" : "Biz"} (${m.at}): ${clip(m.text, 300)}`));
  if (opts.forName) t.push("", `Bilgi kopyası: bildirim ${opts.forName} kişisine gitti.`);
  t.push("", `CRM'de aç: ${url}`);
  if (phone) t.push(`Ara: ${fmtPhone(phone)}`);
  t.push("", "—", "Bifire CRM otomatik bildirimi." + (opts.forName ? "" : " Bildirim e-postalarını CRM › Ayarlar'dan kapatabilirsiniz."));
  const text = t.join("\n");

  // ---- HTML ----
  const detailRows = (d?.rows ?? [])
    .map(
      ([l, v], i) =>
        `<tr><td style="padding:10px 0;${i ? `border-top:1px solid ${C.line};` : ""}width:38%;vertical-align:top;font:500 13px/1.4 ${FONT};color:${C.muted};">${esc(l)}</td>` +
        `<td style="padding:10px 0;${i ? `border-top:1px solid ${C.line};` : ""}vertical-align:top;font:600 14px/1.4 ${FONT};color:${C.ink};">${l === "Telefon" && phone ? `<a href="tel:${esc(phone)}" style="color:${C.ink};text-decoration:none;">${esc(v)}</a>` : l === "E-posta" && email ? `<a href="mailto:${esc(email)}" style="color:${C.ink};text-decoration:none;">${esc(v)}</a>` : esc(v)}</td></tr>`,
    )
    .join("");

  const quote = d?.quote
    ? `<tr><td class="px" style="padding:20px 32px 0;"><div style="font:600 12px/1 ${FONT};letter-spacing:.04em;text-transform:uppercase;color:${C.muted};margin-bottom:8px;">${esc(d.quote.label)}</div>` +
      `<div style="background:${C.accentSoft};border-left:3px solid ${C.accent};border-radius:8px;padding:14px 16px;font:400 14px/1.6 ${FONT};color:${C.ink};">${nl2br(clip(d.quote.text, 1200))}</div></td></tr>`
    : "";

  const messages = d?.messages?.length
    ? `<tr><td class="px" style="padding:20px 32px 0;"><div style="font:600 12px/1 ${FONT};letter-spacing:.04em;text-transform:uppercase;color:${C.muted};margin-bottom:10px;">Son mesajlar</div>` +
      d.messages
        .map(
          (m) =>
            `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:8px;"><tr><td align="${m.inbound ? "left" : "right"}">` +
            `<div style="display:inline-block;max-width:85%;text-align:left;background:${m.inbound ? "#f1efec" : C.accentSoft};border-radius:12px;padding:10px 14px;">` +
            `<div style="font:400 14px/1.5 ${FONT};color:${C.ink};">${nl2br(clip(m.text, 500))}</div>` +
            `<div style="font:400 11px/1 ${FONT};color:${C.muted};margin-top:6px;">${m.inbound ? "Müşteri" : "Biz"} · ${esc(m.at)}</div></div></td></tr></table>`,
        )
        .join("") +
      `</td></tr>`
    : "";

  const buttons = [
    button(url, "CRM'de aç", true),
    phone ? button(`tel:${phone}`, "Ara", false) : "",
    waDigits.length >= 10 ? button(`https://wa.me/${waDigits}`, "WhatsApp", false) : "",
    email ? button(`mailto:${email}`, "E-posta", false) : "",
  ].join("");

  const preheader = clip([k.intro, ...(d?.rows ?? []).slice(0, 3).map(([, v]) => v)].filter(Boolean).join(" · "), 140);

  const html = `<!doctype html>
<html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light"><style>@media (max-width:480px){.px{padding-left:20px!important;padding-right:20px!important}}</style><title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background:${C.page};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${esc(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.page};"><tr><td align="center" style="padding:28px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;background:${C.card};border-radius:16px;border:1px solid ${C.line};">
  <tr><td class="px" style="padding:24px 32px;border-bottom:1px solid ${C.line};">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      <td><a href="${esc(base)}" target="_blank" style="text-decoration:none;"><img src="${esc(base)}/brand/bifire-logo.png" width="136" height="36" alt="Bifire Şömine" style="display:block;border:0;width:136px;height:auto;font:700 18px ${FONT};color:${C.ink};"></a></td>
      <td align="right" style="font:600 11px/1 ${FONT};letter-spacing:.08em;text-transform:uppercase;color:${C.muted};">CRM Bildirimi</td>
    </tr></table>
  </td></tr>
  <tr><td class="px" style="padding:28px 32px 0;">
    <span style="display:inline-block;background:${k.bg};color:${k.fg};border-radius:999px;padding:6px 12px;font:700 12px/1 ${FONT};letter-spacing:.02em;">${esc(k.label)}</span>
    <h1 style="margin:14px 0 0;font:700 22px/1.3 ${FONT};color:${C.ink};">${esc(n.title)}</h1>
    <p style="margin:10px 0 0;font:400 15px/1.6 ${FONT};color:${C.muted};">${esc(greeting)}${k.intro ? "<br>" + esc(k.intro) : ""}</p>
    ${n.body ? `<p style="margin:10px 0 0;font:400 15px/1.6 ${FONT};color:${C.ink};">${nl2br(n.body)}</p>` : ""}
  </td></tr>
  ${detailRows ? `<tr><td class="px" style="padding:20px 32px 0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid ${C.line};border-radius:12px;"><tr><td style="padding:4px 18px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${detailRows}</table></td></tr></table></td></tr>` : ""}
  ${quote}
  ${messages}
  <tr><td class="px" style="padding:24px 32px 12px;">${buttons}</td></tr>
  ${opts.forName ? `<tr><td class="px" style="padding:0 32px 20px;"><div style="background:#f7f5f2;border-radius:10px;padding:10px 14px;font:400 13px/1.5 ${FONT};color:${C.muted};">Bilgi kopyası — bu bildirim CRM'de <strong style="color:${C.ink};">${esc(opts.forName)}</strong> kişisine gitti.</div></td></tr>` : ""}
  <tr><td class="px" style="padding:18px 32px 24px;border-top:1px solid ${C.line};font:400 12px/1.6 ${FONT};color:${C.muted};">
    Bu e-posta Bifire CRM tarafından otomatik gönderildi.${opts.forName ? "" : " Bildirim e-postalarını CRM › Ayarlar'dan kapatabilirsiniz."}<br>
    <a href="${esc(base)}" target="_blank" style="color:${C.accent};text-decoration:none;">${esc(base.replace(/^https?:\/\//, ""))}</a>
  </td></tr>
</table>
</td></tr></table>
</body></html>`;

  return { subject, text, html };
}
