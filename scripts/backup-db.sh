#!/usr/bin/env bash
# Bifire CRM — şifreli günlük veritabanı yedeği.
# Sunucuda cron ile (ör. 03:15) çalıştırılır. Gereken: pg_dump (PG 18 istemcisi), gpg, aws-cli veya rclone.
#
# Ortam (/var/www/bifire-crm/.env.backup — commit edilmez):
#   DIRECT_URL            pooler'sız Neon bağlantısı (salt-okuma yetkili ayrı rol önerilir)
#   BACKUP_GPG_RECIPIENT  yedeği şifreleyecek açık anahtar (özel anahtar sunucuda TUTULMAZ)
#   BACKUP_REMOTE         ör. s3://bifire-crm-backups/db  (versioning + object lock açık bucket)
#   BACKUP_LOCAL_DIR      ör. /var/backups/bifire-crm (son 7 gün yerel kopya)
#   DATABASE_URL          backup.last ayarını yazmak için
set -euo pipefail

: "${DIRECT_URL:?DIRECT_URL gerekli}"
: "${BACKUP_GPG_RECIPIENT:?BACKUP_GPG_RECIPIENT gerekli}"
: "${BACKUP_REMOTE:?BACKUP_REMOTE gerekli}"
LOCAL_DIR="${BACKUP_LOCAL_DIR:-/var/backups/bifire-crm}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
FILE="bifire-crm-${STAMP}.dump.gpg"
mkdir -p "$LOCAL_DIR"
umask 077

# Custom format (-Fc): pg_restore ile seçici geri dönüş mümkün. Bağlantı dizesi argüman olarak değil ortamdan.
PGCONNECT_TIMEOUT=30 pg_dump --format=custom --no-owner --no-privileges --dbname="$DIRECT_URL" \
  | gpg --batch --yes --trust-model always --encrypt --recipient "$BACKUP_GPG_RECIPIENT" --output "$LOCAL_DIR/$FILE"

SIZE="$(stat -c %s "$LOCAL_DIR/$FILE")"
if [ "$SIZE" -lt 1024 ]; then
  echo "HATA: yedek dosyası şüpheli derecede küçük ($SIZE bayt)" >&2
  exit 1
fi

if command -v aws >/dev/null 2>&1; then
  aws s3 cp "$LOCAL_DIR/$FILE" "$BACKUP_REMOTE/$FILE" --only-show-errors
else
  rclone copyto "$LOCAL_DIR/$FILE" "$BACKUP_REMOTE/$FILE"
fi

find "$LOCAL_DIR" -name 'bifire-crm-*.dump.gpg' -mtime +7 -delete

# CRM "Ayarlar › Yedek durumu" kartı için kayıt (restoreVerifiedAt korunur).
psql "${DATABASE_URL:-$DIRECT_URL}" -v ON_ERROR_STOP=1 -q <<SQL
INSERT INTO settings ("key","value","updatedAt") VALUES ('backup.last', jsonb_build_object('at', now(), 'file', '$FILE', 'sizeBytes', $SIZE), now())
ON CONFLICT ("key") DO UPDATE SET "value" = settings."value" || jsonb_build_object('at', now(), 'file', '$FILE', 'sizeBytes', $SIZE), "updatedAt" = now();
SQL

echo "Yedek tamam: $FILE ($SIZE bayt)"
