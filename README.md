# Bifire CRM

Bifire Şömine için müşteri, satış fırsatı, proje (üretim/montaj) ve görev yönetimi. Arayüz Türkçe; kod ve veritabanı İngilizce. Canlı siteden (`Bifire/`) ayrı uygulama ve ayrı PostgreSQL veritabanı.

## Yerel çalıştırma
```bash
npm install
cp .env.example .env              # değerleri doldurun (sırlar en az 32 karakter)
npx prisma migrate deploy         # DIRECT_URL ile
npm run user:create-admin -- --email=ad@ornek.com --name="Ad Soyad"   # davet linki basar
npm run dev                       # http://localhost:3720
npm run worker                    # ayrı terminal: hatırlatma + iş kuyruğu
```

## Komutlar
| Komut | Açıklama |
|---|---|
| `npm run lint` / `typecheck` / `test` / `build` | kalite kapıları (testler DB'ye yazmaz) |
| `npm run worker [-- --once]` | arka plan işçisi |
| `npm run db:seed:demo [-- --clear]` | yalnız dev/staging demo verisi ("demo" etiketli) |
| `npm run backup:db` | şifreli yedek (sunucuda, bkz. `docs/BACKUP_RESTORE.md`) |

## Dokümanlar
- `docs/FAZ0_KESIF.md` — keşif, riskler, site entegrasyon planı (geri alınabilir)
- `docs/ERD.md` — veri modeli ve API taslağı
- `docs/PLAN.md` — fazlar ve kabul testleri (durumla)
- `docs/SECURITY.md`, `docs/BACKUP_RESTORE.md`, `docs/DEPLOY.md`

## Kurallar
- Gizli bilgi commit edilmez; yalnız `.env.example` anahtar adlarını içerir.
- Production DB'de migration/seed/silme kullanıcı onayı olmadan yapılmaz; demo verisi production'a girmez.
- Entegrasyon durumu yalnız gerçek bağlantı varsa "Bağlı" görünür.
