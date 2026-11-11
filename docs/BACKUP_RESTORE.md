# Yedekleme ve Geri Yükleme

## Hedefler
- **RPO** (en fazla veri kaybı): 24 saat (günlük `pg_dump`) — Neon PITR açıksa pratikte dakikalar.
- **RTO** (yeniden çalışır hale gelme): 2 saat.
- Saklama: yerel 7 gün, uzak bucket 35 gün günlük + 12 ay aylık (bucket lifecycle kuralı).

## Katmanlar
1. **Neon PITR** (sağlayıcı geçmişi) — yanlış silme gibi yakın olaylar için en hızlı dönüş: Neon konsolunda zaman noktasından branch açılır, doğrulanır, uygulama o branch'e yönlendirilir.
2. **Günlük mantıksal yedek** — `scripts/backup-db.sh` (cron 03:15): `pg_dump -Fc` → GPG ile açık anahtara şifreleme → S3 uyumlu, versiyonlu, object-lock açık bucket. Özel anahtar sunucuda **tutulmaz**.
3. **Dosyalar** — özel bucket'ta versiyonlama + ayrı hesaba replikasyon (R2/S3 lifecycle).

`backup-db.sh` her başarılı çalışmada `settings.backup.last` kaydını günceller; CRM › Ayarlar › Yedek durumu bunu gösterir (24 saatten eskiyse uyarı).

## Cron
```
15 3 * * * cd /var/www/bifire-crm && set -a && . ./.env.backup && set +a && bash scripts/backup-db.sh >> /var/log/bifire-crm-backup.log 2>&1
```

## Geri yükleme (tatbikat — ayda bir)
1. Boş bir Neon branch/DB aç (production'a **değil**).
2. Yedeği indir ve çöz (özel anahtar yalnız yetkili kişide):
   `gpg --decrypt bifire-crm-YYYYMMDDTHHMMSSZ.dump.gpg > restore.dump`
3. `pg_restore --no-owner --no-privileges --dbname="$RESTORE_DIRECT_URL" restore.dump`
4. Doğrula: `npx prisma migrate status` (güncel), tablo sayıları, son kayıt tarihleri, rastgele 5 müşteri kartı.
5. `restore.dump` dosyasını güvenli sil (`shred -u`).
6. Production DB'de tatbikat sonucunu işaretle:
   `UPDATE settings SET value = value || jsonb_build_object('restoreVerifiedAt', now()) WHERE key = 'backup.last';`

## Gerçek olayda
1. Yazmayı durdur: `pm2 stop bifire-crm bifire-crm-worker` (site formları etkilenmez; Faz 2 outbox bekletir).
2. PITR ile mümkünse olay öncesine branch → doğrula → `DATABASE_URL`/`DIRECT_URL` güncelle.
3. Değilse son günlük yedekten geri yükle (yukarıdaki adımlar) → aradaki talepler site DB'sinden/outbox'tan yeniden aktarılır.
4. `pm2 start` → `/api/health` → denetim kaydına olay notu.
