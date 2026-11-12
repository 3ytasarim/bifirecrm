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

## Faz 2: siteyi CRM'e bağlama (onayla, CRM canlıya alındıktan sonra)
1. Sır üret: `openssl rand -base64 48` → CRM `.env` `WEBSITE_HMAC_SECRET`, site `.env` `CRM_WEBSITE_HMAC_SECRET` (aynı değer). `pm2 restart bifire-crm --update-env`.
2. Site deploy (kod; bayrak hâlâ `false`). Site davranışı değişmez.
3. Site `.env`: `CRM_INTAKE_URL=https://crm.bifiresomine.com`, `CRM_FORWARD_ENABLED=true` → `npm run crm:forward -- --check` "BAŞARILI (200)" olmalı. Değilse bayrağı geri `false` yap.
4. `pm2 restart <site> --update-env`; sitede bir test talebi gönder → CRM › Talepler'de ≤1 dk görünmeli (worker açık olmalı), sonra test kaydını CRM'de “Reddet” ile kapat.
5. Cron (site sunucusu): `*/10 * * * * cd /var/www/bifire && npm run crm:forward >> logs/crm-forward.log 2>&1`
6. CRM › Ayarlar › Web talepleri: otomatik sorumlu seç (boşsa yöneticilere bildirim).
7. 48 saat izle: CRM › Entegrasyonlar (dead-letter = 0), `logs/crm-forward.log` (hata=0).
8. Geri alma: site `.env` `CRM_FORWARD_ENABLED=false` + `pm2 restart <site> --update-env`. Site DB'sine hiçbir şey eklenmediği için başka adım yok.

## Faz 4: kanalları bağlama (onayla, CRM canlıda ve https ile erişilebilirken)
Gizli değerler yalnız sunucu `.env`'ine yazılır; her adımdan sonra `pm2 restart bifire-crm bifire-crm-worker --update-env`.
1. **Meta uygulaması** (developers.facebook.com, Business türü, Bifire Business hesabına bağlı): App secret → `META_APP_SECRET`; rastgele bir `META_VERIFY_TOKEN` üret.
2. **Webhook:** Callback URL `https://crm.bifiresomine.com/api/v1/webhooks/meta`, verify token aynı değer. Abonelikler: Page → `leadgen`; Instagram → `messages`; WhatsApp Business Account → `messages`, `message_template_status_update`.
3. **Lead Ads:** sayfaya erişimli System User token'ı (`leads_retrieval`, `pages_manage_metadata`, `pages_show_list`) → `META_ACCESS_TOKEN`; uygulamayı sayfaya abone et. Meta'nın "Lead Ads Testing Tool"u ile bir test lead'i gönder → CRM › Talepler'de bir kez görünmeli.
4. **Instagram DM:** Instagram profesyonel hesap kimliği → `INSTAGRAM_ACCOUNT_ID` (`instagram_manage_messages`). Test hesabından DM → CRM › Mesajlar.
5. **WhatsApp (ayrı numara):** numarayı WhatsApp Business hesabına ekle ve doğrula; `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_BUSINESS_ACCOUNT_ID`, kalıcı System User token'ı (`whatsapp_business_messaging`, `whatsapp_business_management`) → `WHATSAPP_ACCESS_TOKEN`. Şablonları Meta'da oluştur/onaylat → CRM › Entegrasyonlar › "Meta'dan senkronize et". Test numarasından yaz → yazışma görünmeli; onaylı UTILITY şablonla yanıt gönder → durum "İletildi/Okundu".
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
