# Site tarafı (Bifire web sitesi → CRM aktarımı)

Bu klasör, Faz 2 için **site reposunda** (`3ytasarim/bifire`) yapılan değişikliğin kopyasıdır. CRM uygulaması bu klasörü kullanmaz; amaç, CRM'e ait tüm işin tek yerde görünmesidir.

| Dosya | İçerik |
|---|---|
| `0001-crm-aktarim.patch` | Sitedeki commit'in tamamı (6 dosya): `src/lib/crm/forward.ts`, `scripts/crm-forward.ts`, iki form action'ına birer çağrı, `package.json` betiği, `.env.example` anahtarları |
| `dosyalar/` | Yeni iki dosyanın okunabilir kopyası |

## Siteye uygulama

```bash
cd /path/to/bifire
git apply --check /path/to/bifirecrm/site-entegrasyon/0001-crm-aktarim.patch
git am /path/to/bifirecrm/site-entegrasyon/0001-crm-aktarim.patch
```

- Site DB'sinde migration **yoktur**.
- `CRM_FORWARD_ENABLED=false` varsayılandır; bayrak kapalıyken site bugünküyle birebir aynı çalışır.
- Bağlantıyı açma, cron ve geri alma adımları: `docs/DEPLOY.md` → "Faz 2".
