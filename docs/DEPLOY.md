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

## Kontrol listesi (canlı sonrası)
- [ ] `/api/health` 200, `X-Robots-Tag: noindex`, HSTS başlığı
- [ ] Davet → şifre → giriş → MFA kurulumu
- [ ] Hızlı kayıt + çift kayıt kontrolü
- [ ] Dosya yükleme/indirme (S3)
- [ ] Worker logu: dakikalık tarama
- [ ] İlk gece yedeği + Ayarlar › Yedek durumu
