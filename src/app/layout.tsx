import type { Metadata, Viewport } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import { cookies } from "next/headers";
import "./globals.css";

const jakarta = Plus_Jakarta_Sans({ subsets: ["latin", "latin-ext"], variable: "--font-jakarta", display: "swap" });

export const metadata: Metadata = {
  title: { default: "Bifire CRM", template: "%s · Bifire CRM" },
  description: "Bifire Şömine müşteri, satış ve proje yönetimi",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#e9e3d9" },
    { media: "(prefers-color-scheme: dark)", color: "#11110f" },
  ],
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const theme = (await cookies()).get("bcrm_theme")?.value;
  return (
    <html lang="tr" data-theme={theme === "light" || theme === "dark" ? theme : undefined} className={jakarta.variable}>
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}
