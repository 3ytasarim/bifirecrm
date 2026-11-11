# Faz Planı ve Kabul Testleri

Durum işaretleri: ✅ tamam ve doğrulandı · 🟡 kod hazır, gerçek ortam doğrulaması bekliyor · ⬜ başlanmadı

## Faz 0 — Keşif ✅
Rapor: `FAZ0_KESIF.md`, model/API: `ERD.md`. Canlı siteye dokunulmadı.

## Faz 1 — Çekirdek CRM ✅ (2026-11-11)

| Modül | Kabul testi | Durum |
|---|---|---|
| Veri modeli | Migration CRM DB'ye uygulandı, `migrate status` güncel | ✅ |
| Giriş / davet | Davet linki → şifre belirleme (12+ karakter kuralı, eşleşmeme hatası alanı korur) → giriş; yanlış şifre genel hata | ✅ tarayıcıda |
| Kilit / hız sınırı | 8 hatalı denemede 15 dk kilit; DB tabanlı sınır | 🟡 kod + birim |
| MFA (TOTP) | RFC 6238 vektörleri, ±1 adım | ✅ birim · QR akışı tarayıcıda denenmedi |
| Hızlı kayıt | Yeni kişi → müşteri + fırsat + 24 saat YÜKSEK "İlk dönüş" görevi + KVKK kanıtı; telefon E.164 | ✅ tarayıcı + DB |
| Çift kayıt | Aynı telefon farklı biçimde → aday gösterilir, sessiz kayıt yok; mevcut kayda bağlama yeni müşteri açmaz | ✅ |
| Çift kayıt + yetki | Yetkisiz kullanıcı adayı görür ama ad/telefon/e-posta gizli | ✅ |
| Fırsat aşaması | Aşama değişimi → geçmiş + aktivite + denetim; "Kaybedildi" nedensiz reddedilir | ✅ |
| Kanban sürükle-bırak | Sıra/aşama kalıcı | 🟡 aynı servis doğrulandı; sürükleme tarayıcıda denenmedi (önizleme paneli gizliydi) |
| Proje | Yalnız kazanılan fırsattan; tarih değişince onay sıfırlanır; beklemeye alma notu zorunlu | 🟡 kod |
| Görevler | Atama, durum, hatırlatma/gecikme/eskalasyon taraması (worker) | ✅ worker tek tur |
| Dosyalar | Yükleme → EXIF temizliği + önizleme; sahte uzantılı .exe reddedilir; imzasız/sahte imzalı link 403; oturumsuz 401 | ✅ |
| RBAC | Satış: başkasının müşterisi/fırsatı 404 (veri sızmaz), kullanıcılar/denetim/birleştir → yetkisiz, CSV 403 | ✅ |
| Kullanıcılar | Davet (SMTP yokken link ekranda), rol, izin matrisi, son süper yönetici korunur | ✅ davet · diğerleri 🟡 |
| Dışa aktarma / denetim | CSV (formül enjeksiyonu korumalı), denetim filtreleri | ✅ birim · 🟡 UI |
| Entegrasyonlar | Gerçek durum: hepsi "Yapılandırılmadı"; sahte "bağlandı" yok | ✅ |
| Kalite kapıları | `lint`, `typecheck`, 26 birim testi, `next build` | ✅ |

## Faz 2 — Web sitesi → CRM ✅ kod hazır (2026-11-11) · canlıda bayrak KAPALI
- Site (4 dosya + 2 yeni, `CRM_FORWARD_ENABLED=false` varsayılan): form talebi önce site DB'sine yazılır (değişmedi), yanıttan sonra `after()` ile CRM'e imzalı gönderilir; kaçanlar `npm run crm:forward` (cron, mutabakat) ile tamamlanır. **Site DB'sinde migration yok** (outbox tablosu yerine `ContactRequest` + CRM tarafı tekilleştirme).
- CRM: `POST /api/v1/intake/website` (fotoğraf base64 aynı istekte), `POST /api/v1/intake/website/status` (mutabakat), worker `website.ingest`, Ayarlar › Web talepleri (otomatik sorumlu), Talepler › “İşle” (çoklu eşleşme).
- Kabul testleri (yerel dev, sentetik QA verisi, sonra silindi):
  - [x] imzalı başvuru 202 → worker → müşteri + fırsat + 24 sa “İlk dönüş” görevi + KVKK kanıtı + denetim
  - [x] aynı submissionId tekrar → 200 duplicate, tek kayıt; birebir tekrar (aynı nonce) → 409
  - [x] yanlış sır / 10 dk eski zaman / imzasız → 401; geçersiz yük → 422
  - [x] aynı kişi (telefon farklı yazımla) ikinci başvuru → mevcut açık fırsata eklendi, yeni kart açılmadı
  - [x] iki farklı müşteriyle eşleşen başvuru → “Yeni” bekletildi, tarayıcıda “İşle” → seçim → dönüştürüldü
  - [x] GPS EXIF'li foto → depoda EXIF yok; sahte exe reddedildi, başvuru düşmedi (olayda not)
  - [x] sitenin kendi imza kodu (`npm run crm:forward -- --check`) CRM'de doğrulandı: doğru sır 200, yanlış sır 401, CRM erişilemez → hata, form etkilenmez
  - [x] otomatik sorumlu ayarı → fırsat/görev atanır, bildirim gider
  - [ ] gerçek `ContactRequest` ile uçtan uca gönderim — site `.env` canlı DB'ye bağlı olabileceği için yapılmadı; staging/canlıda bayrak açılırken yapılacak (`DEPLOY.md` Faz 2 adımları)

## Faz 3 — Satış araçları ✅ kod hazır (2026-11-12)
Takvim (randevu + keşif), teklif oluşturma (kalemler, KDV, PDF, onay akışı, T- numarası), mesaj şablonları, raporlar (kaynak/dönüşüm/kayıp nedeni/süre), nonce'lı CSP.
- **Kabul:** teklif PDF'i doğru tutarlar; onay olmadan "gönderildi"ye geçilmez; rapor sayıları DB sorgularıyla birebir.
- **Teklif:** `lib/quotes/calc.ts` kayan nokta kullanmaz (BigInt; miktar ×1000, tutar/oran ×100, satır bazında yarım yukarı). Ekran, sunucu ve PDF aynı fonksiyonu kullanır; PDF üretilirken toplamlar kalemlerden yeniden hesaplanır, DB toplamı tutmazsa PDF üretilmez. Durumlar: Taslak → Onay bekliyor → Onaylandı → Gönderildi → Kabul/Ret; ret gerekçesi zorunlu, hazırlayan kendi teklifini onaylayamaz (SUPER_ADMIN hariç), yalnız taslak düzenlenir, sonrası “Revize et” (yeni sürüm). “Gönderildi”de PDF özel depoya bir kez yazılır, fırsat dosyalarına eklenir ve sonra hep o dosya verilir. **Otomatik e-posta/WhatsApp gönderimi yok** (kanal bağlı değil). Antet/şart/geçerlilik: Ayarlar › Teklif bilgileri.
- **Takvim:** haftalık görünüm + zamanı bekleyen talepler; müşteri/fırsat/proje bağlantısı (aynı müşteri kontrolü), aynı kişiye çakışan planlı randevu engeli (bilinçli “çakışmaya rağmen kaydet”), keşif/showroom onayında fırsat yalnız ileri taşınır.
- **Şablonlar:** yalnız tanımlı `{{değişken}}`ler (bilinmeyen reddedilir); müşteri için doldurulmuş önizleme + kopyala; eksik değerler işaretlenir. Gönderim yok.
- **Raporlar:** tanımlar sayfada yazılı; ham SQL (`services/reports.ts`).
- **CSP:** `proxy.ts` her istekte nonce üretir; `script-src 'self' 'nonce-…' 'strict-dynamic'` (prod'da `unsafe-inline`/`unsafe-eval` yok). Stil için `'unsafe-inline'` kalır (style öznitelikleri).
- Kabul testleri (yerel dev, QA verisi, sonra silindi):
  - [x] `scripts/qa-quotes.ts`: elle hesaplanan toplamlar DB'yle aynı; taslak/onay bekleyen teklif “gönderildi” yapılamaz; satışçı onaylayamaz; gerekçesiz ret olmaz; hazırlayan kendi teklifini onaylayamaz; kurcalanmış DB toplamıyla PDF üretilmez; revize eski sürümü değiştirmez
  - [x] PDF görsel kontrol: Türkçe karakterler, KDV dökümü, çok sayfa (45 kalem) + filigran, boş sayfa yok
  - [x] tarayıcı: “45.000” binlik olarak kaydedildi; canlı toplam = DB = PDF (100.775,55 ₺); onay → gönderildi → aynı PDF tekrar indirildiğinde bayt bayt aynı; fırsat “Teklif gönderildi”
  - [x] `scripts/qa-reports.ts`: bilinen QA verisinde kaynak/huni/kayıp/aşama süresi/ilk temas/teklif rakamları elle hesapla aynı; filtresiz rapor bağımsız ORM sayımlarıyla aynı
  - [x] çakışan randevu engellendi (form verisi korundu); şablonda `{{adi}}` reddedildi; önizleme gerçek kayıtlardan doldu
  - [x] satış rolü: raporlar → /yetkisiz (veri HTML'e sızmıyor), şablon düzenleme yok; CSP başlığında nonce, konsolda ihlal yok
  - [x] kalite kapıları: `lint`, `tsc`, 49 birim testi, `next build`

## Faz 4 — Kanal entegrasyonları ⬜ (hesap/token gerekir)
Meta Lead Ads, Instagram DM, WhatsApp Cloud API, Google Calendar.
- **Kabul:** gerçek test hesabından gelen olay tek kez işlenir; token süresi dolunca durum "Hata" + bildirim; giden mesaj yalnız onaylı şablonla.

## Faz 5 — Canlıya geçiş ⬜ (onay gerekir)
Sunucu (PM2 web + worker), nginx + TLS, S3 özel bucket, ClamAV, SMTP, günlük şifreli yedek + geri yükleme tatbikatı, izleme (health + uptime), production DB (ayrı Neon branch/proje), ilk süper yönetici `create-admin`.
- **Kabul:** `DEPLOY.md` kontrol listesi; geri yükleme tatbikatı başarılı ve `backup.last.restoreVerifiedAt` yazılı.
