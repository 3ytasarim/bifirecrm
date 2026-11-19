/**
 * Bildirim e-postası şablonunun önizlemesi (veritabanı ve SMTP KULLANMAZ; örnek veriyle HTML üretir).
 *   npx tsx scripts/preview-notification-mail.ts <çıktı-klasörü>
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { notificationMail } from "@/lib/jobs/notification-mail-template";

const out = process.argv[2] ?? "mail-preview";
mkdirSync(out, { recursive: true });
const appUrl = process.env.PREVIEW_APP_URL ?? "https://crm.bifiresomine.com";
const contact = { name: "Örnek Müşteri", phone: "+905321234567", email: "ornek@example.test" };
const samples = {
  hatirlatma: notificationMail(
    { type: "task_reminder", title: "Hatırlatma: İlk dönüş: Örnek Müşteri", body: null, link: "/gorevler?id=00000000-0000-0000-0000-000000000001" },
    { appUrl, forName: "Bifire Yönetici", details: { rows: [["Görev", "İlk dönüş: Örnek Müşteri"], ["Son tarih", "20.11.2026 10:00 (5 dakika önce)"], ["Öncelik", "Yüksek"], ["Durum", "Açık"], ["Sorumlu", "Bifire Yönetici"], ["Müşteri", contact.name], ["Telefon", "+90 532 123 45 67"], ["E-posta", contact.email], ["Fırsat", "F-000042 · Örnek Müşteri — Bioetanol şömine"]], quote: { label: "Görev notu", text: "Web sitesinden gelen talep. Salon için ölçü sorulacak, fiyat aralığı paylaşılacak." }, contact } },
  ),
  talep: notificationMail(
    { type: "lead", title: "Yeni talep: Örnek Müşteri", body: null, link: "/firsatlar/00000000-0000-0000-0000-000000000002" },
    { appUrl, userName: "Emrah", details: { rows: [["Fırsat", "F-000042 · Örnek Müşteri"], ["Müşteri", contact.name], ["Telefon", "+90 532 123 45 67"], ["E-posta", contact.email], ["Konum", "Kadıköy / İstanbul"], ["Kaynak", "Web sitesi · Seçim rehberi"], ["İlgilendiği ürün", "Bioetanol · Duvar tipi"], ["Aşama", "Yeni"], ["Sorumlu", "Emrah"]], quote: { label: "Müşterinin mesajı", text: "Merhaba, salonumuz için 120 cm civarı bir bioetanol şömine düşünüyoruz. Keşif için ne zaman gelebilirsiniz?" }, contact } },
  ),
  mesaj: notificationMail(
    { type: "message", title: "Yeni WhatsApp mesajı: Örnek Müşteri", body: null, link: "/mesajlar/00000000-0000-0000-0000-000000000003" },
    { appUrl, userName: "Emrah", details: { rows: [["Kanal", "WhatsApp"], ["Müşteri", contact.name], ["Telefon", "+90 532 123 45 67"], ["Kayıt", "CRM'de kayıtlı müşteri"], ["Son mesaj", "20.11.2026 00:41"]], messages: [{ inbound: true, text: "Merhaba, fiyat listesi alabilir miyim?", at: "20.11.2026 00:38" }, { inbound: false, text: "Merhaba, hemen gönderiyorum. Hangi model ilginizi çekti?", at: "20.11.2026 00:40" }, { inbound: true, text: "Duvar tipi olan, 120 cm.", at: "20.11.2026 00:41" }], contact: { ...contact, email: null } } },
  ),
  gecikme: notificationMail({ type: "task_overdue", title: "Geciken görev: İlk dönüş: Örnek Müşteri", body: null, link: "/gorevler?id=x" }, { appUrl, userName: "Emrah", details: null }),
};
for (const [name, m] of Object.entries(samples)) {
  writeFileSync(join(out, `${name}.html`), m.html);
  writeFileSync(join(out, `${name}.txt`), `Konu: ${m.subject}\n\n${m.text}`);
}
console.log("yazıldı:", Object.keys(samples).join(", "), "→", out);
