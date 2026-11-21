# Canlıya Geçiş (taslak — onay olmadan uygulanmaz)

Hedef: `https://crm.bifiresomine.com`, sunucuda `/var/www/bifire-crm`, PM2 ile iki süreç (`bifire-crm` web, `bifire-crm-worker`). Canlı site ayrı süreç/dizinde, etkilenmez.

## Ön koşullar
- [ ] Production DB: ayrı Neon branch/proje (bu repo ile gelen DB staging kalır).
- [ ] DNS: `crm` A/AAAA kaydı → sunucu; TLS (certbot).
- [ ] Özel S3 bucket (dosyalar) + ayrı yedek bucket (versiyonlama + object lock).
- [ ] SMTP (iç bildirim + davet).
- [ ] ClamAV (opsiyonel, önerilir).
- [ ] `.env` sunucuda elle oluşturulur (`chmod 600`), sırlar ortama özel üretilir.

## İlk kurulum
```bash
git clone <repo> /var/www/bifire-crm && cd /var/www/bifire-crm
npm ci                           # --omit=dev KULLANMAYIN: worker tsx ile çalışır
npx prisma migrate deploy        # DIRECT_URL ile
npm run build
pm2 start deploy/ecosystem.config.cjs && pm2 save
npm run user:create-admin -- --email=<yonetici e-postası> --name="<Ad Soyad>"
```
nginx: `deploy/nginx.crm.conf.example`.

## Güncelleme (sıfır kesintiye yakın)
```bash
cd /var/www/bifire-crm && git fetch && git checkout <etiket>
npm ci && npx prisma migrate deploy && npm run build
pm2 reload bifire-crm && pm2 restart bifire-crm-worker
curl -fsS https://crm.bifiresomine.com/api/health
```
Migration'lar yalnız **ekleyici** (kolon/tablo ekleme) tutulur; silme/yeniden adlandırma iki sürüme bölünür (önce kod uyumu, sonra temizlik).

## Geri dönüş
1. `git checkout <önceki etiket> && npm ci && npm run build && pm2 reload bifire-crm && pm2 restart bifire-crm-worker`
2. Ekleyici migration'lar eski kodla uyumludur → DB geri alınmaz.
3. Veri hatası varsa `BACKUP_RESTORE.md`.

## E-posta bildirimleri (SMTP)
Yeni talep / mesaj, atama, randevu ve görev hatırlatma / gecikme bildirimleri, ilgili çalışanın CRM'deki e-posta adresine de gider (worker, dakikada bir). Müşteriye e-posta gönderilmez.
1. Sunucu `.env`: `SMTP_URL=smtps://destek%40bifiresomine.com:<şifre>@mail.kurumsaleposta.com:465` (alan adının e-postası kurumsaleposta.com'da; `mail.bifiresomine.com` DNS'te YOK. Kullanıcı adındaki `@` → `%40`, şifredeki özel karakterler URL-kodlu), `SMTP_FROM=Bifire CRM <destek@bifiresomine.com>` (SMTP hesabının kendi adresi), isteğe bağlı `NOTIFY_EMAIL_COPY_TO=emrah@bifiresomine.com` (tüm bildirimlerin kopyası; olay başına tek e-posta).
   - **Port 587 seçildi:** `SMTP_URL=smtp://destek%40bifiresomine.com:<şifre>@mail.kurumsaleposta.com:587` + `SMTP_TLS_INSECURE=true`. Sebep: 587'nin sertifikası (`*.natrohost.com`) 12.07.2026'da süresi dolmuş ve ad uyuşmuyor; bu ayar olmadan gönderim "certificate has expired" ile düşer. Ayar sertifika doğrulamasını kapatır ama STARTTLS'i zorunlu tutar (şifresiz bağlantıya düşmez). Risk: araya giren biri sahte sertifikayla şifreyi görebilir. Natro sertifikayı yenileyince `SMTP_TLS_INSECURE` satırını silin (ya da 465'e geçin: `smtps://…:465`, sertifikası geçerli).
2. `pm2 restart bifire-crm bifire-crm-worker --update-env`. CRM › Ayarlar › Sistem: "E-posta (SMTP): Yapılandırıldı".
3. Her çalışanın CRM kullanıcısındaki e-posta adresi gerçek kutusu olmalı (Kullanıcılar ekranı). Kişi Ayarlar'dan e-posta bildirimini kapatabilir.
4. Test: kendinize görev atayıp 1 dk sonrasına hatırlatma koyun → e-posta gelmeli. Gelmezse `pm2 logs bifire-crm-worker` → "e-posta bildirimi: … hata=…".
5. Son 6 saatten eski bildirimler e-postalanmaz (SMTP sonradan açılınca yığın gitmez). Davet / şifre sıfırlama e-postaları da aynı SMTP'yi kullanır.

## Faz 2: siteyi CRM'e bağlama (onayla, CRM canlıya alındıktan sonra)
1. Sır üret: `openssl rand -base64 48` → CRM `.env` `WEBSITE_HMAC_SECRET`, site `.env` `CRM_WEBSITE_HMAC_SECRET` (aynı değer). `pm2 restart bifire-crm --update-env`.
2. Site deploy (kod; bayrak hâlâ `false`). Site davranışı değişmez.
3. Site `.env`: `CRM_INTAKE_URL=https://crm.bifiresomine.com`, `CRM_FORWARD_ENABLED=true` → `npm run crm:forward -- --check` "BAŞARILI (200)" olmalı. Değilse bayrağı geri `false` yap.
4. `pm2 restart <site> --update-env`; sitede bir test talebi gönder → CRM › Talepler'de ≤1 dk görünmeli (worker açık olmalı), sonra test kaydını CRM'de “Reddet” ile kapat.
5. Cron (site sunucusu): `*/10 * * * * cd /var/www/bifire && npm run crm:forward >> logs/crm-forward.log 2>&1`
6. CRM › Ayarlar › Web talepleri: otomatik sorumlu seç (boşsa yöneticilere bildirim).
7. 48 saat izle: CRM › Entegrasyonlar (dead-letter = 0), `logs/crm-forward.log` (hata=0).
8. Geri alma: site `.env` `CRM_FORWARD_ENABLED=false` + `pm2 restart <site> --update-env`. Site DB'sine hiçbir şey eklenmediği için başka adım yok.

## Site formlarını CRM'e çekme (CRM canlıda değilken de çalışır; onayla)
Site CRM'e gönderemiyorsa (CRM yerelde / kapalı) CRM, form taleplerini siteden kendisi çeker. Gönderme yoluyla birlikte de kullanılabilir; çift kayıt açılmaz (submissionId).
1. Sır üret: `openssl rand -base64 48` → CRM `.env` `WEBSITE_HMAC_SECRET`, site `.env` `CRM_WEBSITE_HMAC_SECRET` (aynı değer).
2. Site deploy (çekme ucu kodu; `CRM_PULL_ENABLED` hâlâ `false` → uç 404, site davranışı değişmez).
3. Site `.env`: `CRM_PULL_ENABLED=true` → `pm2 restart <site> --update-env`.
4. CRM `.env`: `WEBSITE_PULL_URL=https://www.bifiresomine.com` (isteğe bağlı `WEBSITE_PULL_INITIAL_DAYS`, varsayılan 7). Web süreci ve worker yeniden başlatılır.
5. CRM › Entegrasyonlar › Bifire web sitesi formları › “Şimdi çek”: son 7 günün talepleri gelir; sonra worker 2 dakikada bir yeni talepleri alır.
6. Geri alma: site `.env` `CRM_PULL_ENABLED=false` (uç yeniden 404) ya da CRM'de `WEBSITE_PULL_URL` boşaltılır. Site DB'sine hiçbir şey yazılmaz.

Not: CRM geliştirme veritabanıyla çalışırken çekilen talepler gerçek müşteri verisidir; CRM canlıya geçince canlı CRM'de yeniden çekilmelidir (imleç her DB'de ayrı tutulur).

## Faz 4: kanalları bağlama (onayla, CRM canlıda ve https ile erişilebilirken)
Gizli değerler yalnız sunucu `.env`'ine yazılır; her adımdan sonra `pm2 restart bifire-crm bifire-crm-worker --update-env`.
1. **Meta uygulaması** (developers.facebook.com, Business türü, Bifire Business hesabına bağlı): App secret → `META_APP_SECRET`; rastgele bir `META_VERIFY_TOKEN` üret.
2. **Webhook:** Callback URL `https://crm.bifiresomine.com/api/v1/webhooks/meta`, verify token aynı değer. Abonelikler: Page → `leadgen`; Instagram → `messages`; WhatsApp Business Account → `messages`, `message_template_status_update`.
3. **Lead Ads:** sayfaya erişimli System User token'ı (`leads_retrieval`, `pages_manage_metadata`, `pages_show_list`) → `META_ACCESS_TOKEN`; uygulamayı sayfaya abone et. Meta'nın "Lead Ads Testing Tool"u ile bir test lead'i gönder → CRM › Talepler'de bir kez görünmeli.
4. **Instagram DM:** Instagram profesyonel hesap kimliği → `INSTAGRAM_ACCOUNT_ID` (`instagram_manage_messages`). Test hesabından DM → CRM › Mesajlar.
   - **API senkronu (webhook yedeği):** worker dakikada bir `GET /{INSTAGRAM_ACCOUNT_ID}/conversations?platform=instagram` ile görüşmeleri, her birinin son 20 mesajını okur (`META_ACCESS_TOKEN`). Webhook ile aynı mesaj tek kayıt olur (mesaj kimliği). Durum `integration_connections.config.igSync` içinde; migration gerekmez. Kilit DB'de: pm2 worker ile cron'daki `worker --once` aynı anda çalışsa da tek senkron yürür.
   - Kontrol (salt okunur, yalnız sayılar): `npx tsx --conditions=react-server scripts/instagram-sync.ts --check` → `fields.*` sayıları, `outbound/inbound`, `businessIdDiffersFromAccountId`.
   - Elle tek tur: `... scripts/instagram-sync.ts --apply` ya da CRM › Entegrasyonlar › Instagram › "Şimdi senkronize et". Durum: `... scripts/instagram-sync.ts` (argümansız).
   - İlk turda 24 saatten eski mesajlar sessiz eklenir (bildirim/talep açılmaz). Meta, mesaj ayrıntısını görüşme başına yalnız son 20 mesaj için verir.
   - Hız sınırı / ağ hatası → 1 → 60 dk geri çekilme; token/izin hatası → bağlantı "Hata" + yönetici bildirimi. Mesajlar hiçbir hatada silinmez.
   - CRM'den Instagram'a yanıt gönderme YOK (ayrı geliştirme); yanıtlar Instagram uygulamasından verilir ve senkronla CRM'e düşer.
5. **WhatsApp — doğrudan Meta (ayrı numara, `WHATSAPP_PROVIDER=meta`):** numarayı WhatsApp Business hesabına ekle ve doğrula; `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_BUSINESS_ACCOUNT_ID`, kalıcı System User token'ı (`whatsapp_business_messaging`, `whatsapp_business_management`) → `WHATSAPP_ACCESS_TOKEN`. Şablonları Meta'da oluştur/onaylat → CRM › Entegrasyonlar › "Meta'dan senkronize et". Test numarasından yaz → yazışma görünmeli; onaylı UTILITY şablonla yanıt gönder → durum "İletildi/Okundu".
5b. **WhatsApp — 360dialog / coexistence (mevcut WhatsApp Business uygulaması numarası, `WHATSAPP_PROVIDER=360dialog`):**
   1. Telefondaki WhatsApp Business uygulaması güncel olmalı (2.24.17+). 360dialog'a kaydol; bağlantıyı işletme hesabının sahibi/yöneticisi kendi Facebook hesabıyla yapar (Embedded Signup, "mevcut WhatsApp Business uygulamasını bağla"), telefonda QR onaylanır. Numara uygulamadan SİLİNMEZ.
   2. 360dialog Hub › API anahtarı oluştur → `D360_API_KEY`; `openssl rand -base64 48` → `D360_WEBHOOK_SECRET`; `WHATSAPP_PROVIDER=360dialog` → `pm2 restart bifire-crm bifire-crm-worker --update-env`.
   3. **Bağlantıdan sonraki 24 saat içinde** webhook kaydı (geçmiş yazışma aktarımı bu sürede tek sefer gelir; kaçarsa yeniden bağlanmak gerekir): `npx tsx --conditions=react-server scripts/d360-webhook.ts` (durum) → `... --apply`.
   4. Test: başka bir telefondan numaraya yaz → CRM › Mesajlar'da görünmeli; telefondaki uygulamadan yanıt ver → CRM'de "uygulamadan" etiketli giden mesaj. Şablonlar: CRM › Entegrasyonlar › senkronize et (360dialog'dan çeker).
   5. Not: uygulamadan gönderilen mesajlar ücretsizdir; CRM'den (API) gönderilen şablonlar Meta API tarifesine girer. Coexistence numarasında hız sınırı 20 mesaj/sn.
   6. Geri alma: `WHATSAPP_PROVIDER=meta` + D360 anahtarlarını boşalt + restart → kanal "Yapılandırılmadı", 360dialog ucu 503. Telefondaki uygulama etkilenmez.
6. **Google Calendar:** Google Cloud'da OAuth istemcisi (Web), yetkili yönlendirme adresi `https://crm.bifiresomine.com/api/v1/oauth/google/callback`, kapsam yalnız `calendar.events` → `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`. CRM › Entegrasyonlar › "Google ile bağlan". Bir randevu oluştur/değiştir/iptal et → takvimde tek etkinlik olarak izle.
7. **Kabul:** aynı test olayını Meta'dan "yeniden gönder" → CRM'de çift kayıt yok; token'ı iptal et → Entegrasyonlar'da "Hata" + bildirim; onaysız şablon gönderilemiyor.
8. Geri alma: ilgili `.env` anahtarlarını boşalt + restart → kanal "Yapılandırılmadı", webhook 503 (Meta yeniden dener; olay kaybolmaz, kısa süre içinde açılırsa işlenir). Google için Entegrasyonlar › "Bağlantıyı kaldır" (token Google'da da iptal edilir).

## Kontrol listesi (canlı sonrası)
- [ ] `/api/health` 200, `X-Robots-Tag: noindex`, HSTS başlığı
- [ ] Davet → şifre → giriş → MFA kurulumu
- [ ] Hızlı kayıt + çift kayıt kontrolü
- [ ] Dosya yükleme/indirme (S3)
- [ ] Worker logu: dakikalık tarama
- [ ] İlk gece yedeği + Ayarlar › Yedek durumu
