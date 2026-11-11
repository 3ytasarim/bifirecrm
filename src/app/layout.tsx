import type { Metadata, Viewport } from "next";
import { DM_Sans, Manrope } from "next/font/google";
import { cookies } from "next/headers";
import "./globals.css";

const dmsans = DM_Sans({ subsets: ["latin", "latin-ext"], variable: "--font-dmsans", display: "swap" });
const manrope = Manrope({ subsets: ["latin", "latin-ext"], variable: "--font-manrope", display: "swap" });

export const metadata: Metadata = {
  title: { default: "Bifire CRM", template: "%s · Bifire CRM" },
  description: "Bifire Şömine müşteri, satış ve proje yönetimi",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f3f0e9" },
    { media: "(prefers-color-scheme: dark)", color: "#181a17" },
  ],
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const theme = (await cookies()).get("bcrm_theme")?.value;
  return (
    <html lang="tr" data-theme={theme === "light" || theme === "dark" ? theme : undefined} className={`${dmsans.variable} ${manrope.variable}`}>
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}
