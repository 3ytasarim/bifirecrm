# Güvenlik Özeti

| Alan | Uygulama |
|---|---|
| Kimlik doğrulama | Argon2id şifre; en az 12 karakter, büyük/küçük harf + rakam. Hesap yokken de sabit süre (kullanıcı varlığı sızmaz). |
| Oturum | DB tabanlı; çerezde yalnız rastgele token, DB'de SHA-256 özeti. `HttpOnly`, `SameSite=Lax`, prod'da `Secure`. 12 saat kayan / 7 gün mutlak süre. Şifre değişince tüm oturumlar düşer. |
| MFA | TOTP (RFC 6238); sır AES-256-GCM ile şifreli saklanır. Yönetici rolleri için zorunlu kılınması önerilir (Faz 5 kararı). |
| Kaba kuvvet | 8 hatalı denemede 15 dk hesap kilidi + IP/e-posta bazlı DB hız sınırı (giriş, sıfırlama, dışa aktarma). IP yalnız HMAC özeti olarak saklanır. |
| Yetki | Rol matrisi + yönetici override'ları (kilitli izinler değiştirilemez). Her sorgu satır kapsamıyla (`scope.ts`) çalışır; yetkisiz kayıt 404 döner, varlığı sızmaz. Son süper yönetici devre dışı bırakılamaz. |
| Girdi | Tüm action'larda Zod; telefon/e-posta normalize; Prisma parametreli sorgu. Ham SQL yalnız `Prisma.sql` şablonlarıyla (iş kuyruğu, raporlar) — kullanıcı girdisi her zaman bağlı parametre. |
| Teklifler | Tutar hesabı BigInt (kayan nokta yok); PDF toplamları kalemlerden yeniden hesaplanır, DB'yle tutmazsa PDF üretilmez. Onaysız teklif “gönderildi” yapılamaz (durum + son onay kaydı + yarış korumalı güncelleme). Onaylanmamış önizlemede filigran. Gönderilen PDF değişmez (özel depo, fırsata bağlı ek). |
| Şablonlar | Yalnız izinli değişkenler; değerler düz metin olarak yerleşir (yeniden işlenmez). CRM şablonları müşteriye kendisi göndermez (WhatsApp için ayrı, Meta onaylı şablonlar). |
| Dosyalar | Uzantıya değil magic-byte'a göre tür; boyut sınırı; fotoğraflar yeniden kodlanır (EXIF/konum silinir); opsiyonel ClamAV; özel depo; indirme linki HMAC imzalı + kullanıcıya bağlı + süreli + oturum ve kayıt erişimi kontrolü; her indirme denetlenir; `Cache-Control: private, no-store`. |
| CSV | UTF-8 BOM, `;` ayırıcı; `= + - @` ile başlayan hücreler etkisizleştirilir. |
| Başlıklar | CSP, HSTS (prod), `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`, `X-Robots-Tag: noindex`. CSP nonce'lı: `proxy.ts` her istekte yeni nonce üretir, `script-src 'self' 'nonce-…' 'strict-dynamic'` (prod'da `unsafe-inline`/`unsafe-eval` yok); tüm sayfalar dinamik render. `style-src 'unsafe-inline'` (style öznitelikleri). `next.config` taban politikası yalnız çerçeveleme/base/object/form kısıtlar. |
| Formlar | Server action'lar Next.js'in Origin kontrolüyle CSRF'e karşı korunur. JS yüklenmeden gönderilen form da POST'tur (alanlar URL'ye düşmez). |
| Sırlar | `.env` git dışında; anahtar adları `.env.example`'da. İstemciye CRM sırrı gitmez. Loglarda sır/şifre yazılmaz. |
| Meta webhook (Faz 4) | `X-Hub-Signature-256` (HMAC-SHA256, app secret, ham gövde, sabit süreli karşılaştırma); 1 MB gövde sınırı; hatalı imza IP başına hız sınırına girer; olay kimlikleri biçim filtresinden geçer (Graph yoluna enjekte edilemez); `(provider, externalEventId)` tekilliği. Başka WhatsApp numarasına / Instagram hesabına ait olaylar yok sayılır. Yapılandırılmadıysa 503. |
| Meta/Google token'ları | Meta token'ları yalnız `.env`'de; Graph'a `Authorization: Bearer` başlığıyla (URL'de değil). Google refresh token AES-256-GCM şifreli DB'de, access token yalnız bellekte. OAuth: PKCE S256 + state, durum şifreli HttpOnly çerezde (10 dk, dar path), yalnız `calendar.events` kapsamı, bağlantı yalnız `integrations.manage`. Sahte sunucu adresleri (`META_GRAPH_URL`, `GOOGLE_*_URL`) production'da yok sayılır. |
| WhatsApp gönderimi | Yalnız onaylı şablon; pazarlama için kayıtlı açık rıza; kanal Hata iken gönderim yok; kullanıcı başına hız sınırı; her gönderim denetlenir. Kalıcı 4xx hataları yeniden denenmez (spam yok). Mesaj içeriği loglanmaz. |
| Site → CRM (Faz 2) | HMAC-SHA256 imza + ±5 dk zaman penceresi + nonce tekrar reddi + `(source, sourceSubmissionId)` idempotency. |
| Denetim | Giriş, yetki, kayıt değişiklikleri (alan farkı, hassas alanlar maskeli), birleştirme, dışa aktarma, dosya indirme. |
| Ortam ayrımı | Demo verisi ve QA temizliği `APP_ENV=production`'da reddeder. Production'da `APP_URL` https zorunlu. |

## Açık maddeler
- Faz 4 gerçek Meta/Google hesap testleri; Meta uygulama incelemesi (`leads_retrieval`, `instagram_manage_messages`, `whatsapp_business_messaging`).
- MFA'nın SUPER_ADMIN/MANAGER için zorunlu yapılması (karar bekliyor).
- ClamAV kurulumu ve `scanStatus` politikası (tarama yoksa dosya "taranmadı" olarak işaretlenir ve indirilebilir).
- `npm audit` CI adımı (Faz 5). Next.js 16.3.8'de Image Optimization (SVG) kritik açığı var (16.4.6'da düzeltildi): CRM `next/image` kullanmıyor ve `images.unoptimized: true` ile uç nokta kapalı; yine de canlıya geçmeden Next.js yükseltilmeli.
