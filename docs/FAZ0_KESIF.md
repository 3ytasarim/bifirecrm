# Faz 0 — Keşif Raporu

Tarih: 2026-11-11 · Kapsam: Bifire Şömine canlı sitesi (`D:\Claude Code Project\Bifire`, salt okunur incelendi) + yeni CRM (`Bifire-CRM`, ayrı repo).

## 1. Bulgular

| Konu | Bulgu |
|---|---|
| Site yığını | Next.js 16 (App Router) + Prisma + Neon PostgreSQL. Formlar **server action** ile çalışıyor (ayrı REST çağrısı yok). |
| Form akışları | `submitRequest` (iletişim / teklif / showroom) ve `submitDesignRequest` (özel tasarım, fotoğraf yüklemeli). Her ikisi önce sitenin kendi `ContactRequest` tablosuna yazar, sonra `safeIntakeRequest` çağırır. |
| Mevcut mini-CRM | Sitede gizli bir CRM katmanı var (`src/lib/crm/intake.ts`, `FEATURES.crm = false`), ayrıca `POST /api/v1/crm/leads` (statik `CRM_INTAKE_TOKEN`). Menüde kapalı; veri sitenin DB'sinde. |
| Fotoğraf | Özel tasarım formu fotoğrafı sitenin `PRIVATE_UPLOAD_DIR` dizinine yazıyor (public değil). |
| Veritabanları | Site ve CRM farklı Neon uç noktalarında → **fiziksel olarak ayrı**. CRM DB keşifte boştu (PG 18, tablo yok); migration yalnız CRM DB'ye uygulandı. |
| Altyapı | Repoda deploy/sunucu konfigürasyonu yok; sunucu (Hetzner varsayımı), nginx, PM2, DNS durumu **doğrulanmadı**. |
| Entegrasyonlar | Meta / WhatsApp / Instagram / Google Calendar için hesap, token veya webhook bilgisi yok. Arayüz bunları dürüstçe "Yapılandırılmadı" gösterir. |

## 2. Riskler

1. **Canlı form kaybı** — site → CRM bağlantısı hatalı kurulursa talep düşebilir. Önlem: site önce kendi DB'sine yazmaya devam eder (bugünkü davranış), CRM'e aktarım ayrı ve tekrar denenebilir (outbox).
2. **Çift kayıt** — aynı kişi farklı formlardan gelir. Önlem: E.164 telefon + normalize e-posta eşleşmesi, sessiz birleştirme yok; `leads (source, sourceSubmissionId)` tekil → aynı gönderim iki kez işlenmez.
3. **Kişisel veri (KVKK)** — telefon/e-posta/fotoğraf. Önlem: özel depo, imzalı + oturuma bağlı dosya linki, EXIF temizliği, denetim kaydı, rıza olaylarının ayrı kanıtı.
4. **Gizli anahtar sızıntısı** — Önlem: `.env` git dışında, istemciye CRM sırrı gitmez, site→CRM HMAC + zaman damgası + nonce.
5. **Neon pooler** — çok komutlu migration pooler'da sessizce kaybolabiliyor (önceki projede yaşandı). Önlem: migration/yedek `DIRECT_URL` ile.
6. **DB'nin rolü belirsiz** — Verilen Neon DB staging mi production mı netleşmedi. Öneri: production için ayrı Neon branch/proje, bu DB staging.

## 3. Entegrasyon noktaları (Faz 2 — uygulandı)

```
Ziyaretçi → site server action → site DB (ContactRequest)   ← bugünkü davranış, DEĞİŞMEDİ
                               └→ after(): yanıt gittikten sonra imzalı POST (bayrak açıksa)
site cron (10 dk) → npm run crm:forward → /status ile eksikleri bul → eksikleri yeniden gönder
CRM /api/v1/intake/website → imza + ±5 dk + nonce (webhook_nonces) → dosyalar özel depoya (EXIF temizliği, tarama)
    → integration_events (provider+externalEventId tekil) + integration_jobs → 202
worker website.ingest → eşleşme → müşteri/fırsat/24 sa görev/KVKK kanıtı/bildirim/denetim
```

**Karar (onaydan sonra, uygulama sırasında):** sitede ayrı `crm_outbox` tablosu açılmadı. Gerekçe: site `.env`'i canlı DB'ye bağlı olabilir; migration canlı DB'ye dokunur. `ContactRequest` zaten kalıcı kaynak; CRM `submissionId` (= ContactRequest.id) ile tekilleştirdiği için mutabakat betiği "outbox" görevini görür. Sonuç: **sitede migration yok**, geri alma yalnız bayrak.

Eşleşme kuralı (web talebinde insan yok, sessiz birleştirme yok): telefon/e-posta ile tek müşteri → o müşteriye bağla (120 gün içinde güncellenmiş açık fırsatı varsa ona ekle); birden çok müşteri → talep "Yeni" bekler, yöneticiye bildirim, Talepler › İşle ile seçilir; eşleşme yok → yeni müşteri.

Fotoğraf: site, dosyayı aynı imzalı JSON istekte base64 olarak iletir; CRM kendi özel deposuna yazar. Site dosyayı silmez.

## 4. Belirsizlikler (kullanıcı onayı gerekir)

- Bu Neon DB staging mi, production mı?
- Sunucu erişimi (SSH), alan adı `crm.bifiresomine.com` DNS yönetimi.
- SMTP sağlayıcısı (iç bildirim + davet e-postası). Yokken davet linki ekranda gösterilir.
- Dosya deposu: S3 uyumlu özel bucket (Cloudflare R2 önerilir) + yedek bucket.
- ClamAV sunucuda kurulacak mı?
- Salt okunur rol tüm kayıtları görsün mü (şu an: evet, yalnız okuma)?
- Sitedeki gizli mini-CRM (`/admin/crm`) kaldırılacak mı, yoksa kapalı kalacak mı?

## 5. Sitede değişen dosyalar (Faz 2 — kullanıcı onayıyla 2026-11-11, commit edilmedi)

| Dosya | Değişiklik |
|---|---|
| `src/app/(site)/actions.ts` | `safeIntakeRequest` sonrasına `forwardToCrmAfterResponse(created.id)` (+1 import, +2 satır) |
| `src/app/(site)/mekaniniza-ozel-tasarim/actions.ts` | aynı |
| `src/lib/crm/forward.ts` (yeni) | bayrak kontrolü, yük oluşturma (foto özel depodan), HMAC imza, `after()` gönderimi, mutabakat, bağlantı testi |
| `scripts/crm-forward.ts` (yeni) | `npm run crm:forward [-- --since=72 \| --dry-run \| --check]` |
| `package.json` | `crm:forward` betiği |
| `.env.example` | `CRM_FORWARD_ENABLED=false`, `CRM_INTAKE_URL`, `CRM_WEBSITE_HMAC_SECRET` |
| `prisma/schema.prisma` | **değişmedi** (migration yok) |

### Geri alınabilir değişiklik planı

1. Tüm site değişiklikleri **`CRM_FORWARD_ENABLED=false`** bayrağının arkasında; bayrak kapalıyken hiçbir ağ isteği yapılmaz, davranış bugünküyle birebir aynı.
2. Site DB'sinde şema değişikliği yok → geri alınacak migration yok.
3. Yayın sırası: site deploy (bayrak kapalı) → CRM uç noktası canlı → staging'de uçtan uca test → bayrak açık → 48 saat izleme (outbox kuyruğu, CRM integration_events).
4. Geri dönüş: bayrağı `false` yap + `pm2 restart <site> --update-env` (rebuild gerekmez) → gerekirse önceki site sürümüne PM2 ile dön. Site DB'deki `ContactRequest` her durumda tam kaynak olarak kalır; CRM'e yeniden aktarım outbox'tan yapılabilir.

## 6. CRM dizin yapısı

```
Bifire-CRM/
  prisma/
    schema.prisma                 # 36 tablo, uuid v7, timestamptz, pg_trgm
    migrations/20261111000000_init/
  src/
    proxy.ts                      # oturum çerezi ön kontrolü
    app/
      (auth)/                     # giris, giris/dogrulama (MFA), sifremi-unuttum, sifre-belirle
      (app)/                      # oturumlu kabuk (sidebar, arama, bildirim, kullanıcı menüsü)
        page.tsx                  # Genel bakış (KPI)
        talepler/                 # talepler + hızlı kayıt (eşleşme kontrolü)
        musteriler/               # liste, detay (sekmeler), düzenle, birleştir
        firsatlar/                # kanban (dnd-kit) + tablo, detay, yeni
        projeler/                 # üretim/montaj aşamaları, tarih onayı
        gorevler/ bildirimler/ ara/
        kullanicilar/             # davet, rol, izin matrisi, oturum iptali
        ayarlar/                  # hesap, şifre, MFA, oturumlar, dışa aktarma, yedek durumu
        ayarlar/denetim/          # denetim kaydı
        entegrasyonlar/           # gerçek durum + iş kuyruğu
        _record/actions.ts        # not, görüşme, görev, dosya (ortak)
      api/files/[id]              # imzalı + oturumlu dosya indirme
      api/export/[entity]         # CSV (yetki + hız sınırı + denetim)
      api/health                  # sağlık kontrolü
    components/ ui/ shell/ record/
    lib/
      auth/ (session, password, totp, tokens)
      rbac/ (permissions, guard, scope)
      services/ (contacts, opportunities, projects, tasks, intake, records)
      jobs/ (queue, reminders)
      storage/ (local | s3, dosya doğrulama, EXIF temizliği)
      env, db, crypto, audit, normalize, format, labels, csv, rate-limit, mailer, notifications
  scripts/
    worker.ts                     # ayrı süreç: kuyruk + hatırlatma
    create-admin.ts               # ilk süper yönetici (davet linki)
    seed-demo.ts                  # yalnız dev/staging, production'da reddeder
    qa-cleanup.ts / qa-peek.ts    # yalnız dev/staging QA yardımcıları
    backup-db.sh                  # şifreli günlük yedek
  deploy/                         # PM2 + nginx örnekleri
  tests/                          # birim testleri (DB'ye yazmaz)
  docs/
```
