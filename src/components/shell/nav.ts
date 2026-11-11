import type { Permission } from "@/lib/rbac/permissions";

export type NavItem = { href: string; label: string; icon: string; perm?: Permission; anyPerm?: Permission[] };

/**
 * Yalnız GERÇEKTEN çalışan modüller menüde. Takvim & Showroom, Teklifler, Mesaj Şablonları ve Raporlar
 * Faz 3'te eklenecek (göstermelik sayfa yok).
 */
export const NAV: NavItem[] = [
  { href: "/", label: "Genel Bakış", icon: "LayoutDashboard" },
  { href: "/talepler", label: "Talepler", icon: "Inbox", perm: "leads.view" },
  { href: "/musteriler", label: "Müşteriler", icon: "Users", anyPerm: ["contacts.view", "contacts.view_all"] },
  { href: "/firsatlar", label: "Satış Fırsatları", icon: "KanbanSquare", anyPerm: ["opportunities.view", "opportunities.view_all"] },
  { href: "/projeler", label: "Projeler / Üretim / Montaj", icon: "Hammer", anyPerm: ["projects.view", "projects.view_all"] },
  { href: "/gorevler", label: "Görevlerim", icon: "CheckSquare" },
  { href: "/entegrasyonlar", label: "Entegrasyonlar", icon: "PlugZap", perm: "integrations.view" },
  { href: "/kullanicilar", label: "Kullanıcılar & Roller", icon: "ShieldCheck", perm: "users.manage" },
  { href: "/ayarlar", label: "Ayarlar", icon: "Settings" },
];
