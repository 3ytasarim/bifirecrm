import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "same-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), interest-cohort=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  { key: "X-Robots-Tag", value: "noindex, nofollow" },
  {
    // Sayfaların asıl CSP'si proxy.ts'te (her istekte nonce). Bu taban politika script kısıtlamaz (nonce'lu politikayla
    // çakışmasın diye); proxy dışında kalan yanıtlarda (statik dosyalar) çerçeveleme/base/object korumasını sağlar.
    key: "Content-Security-Policy",
    value: ["frame-ancestors 'none'", "base-uri 'self'", "object-src 'none'", "form-action 'self'"].join("; "),
  },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  experimental: {
    // Dosya yükleme sınırı (MAX_UPLOAD_MB × en fazla 10 dosya için pay). Nginx client_max_body_size ile uyumlu tutulmalı.
    serverActions: { bodySizeLimit: "60mb" },
  },
  serverExternalPackages: ["@node-rs/argon2", "sharp", "pdfkit"],
  // next/image kullanılmıyor; görüntü optimizasyon uç noktası kapalı (saldırı yüzeyi olmasın).
  images: { unoptimized: true },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
