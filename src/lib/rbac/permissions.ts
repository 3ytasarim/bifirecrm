import type { Role } from "@prisma/client";

/**
 * İzin kataloğu ve varsayılan rol matrisi. Yönetici, role_permissions tablosu ile varsayılanı değiştirebilir
 * (SUPER_ADMIN hariç: her zaman tüm izinlere sahiptir; kilitli izinler değiştirilemez).
 * Satır düzeyi görünürlük ayrıca src/lib/rbac/scope.ts'te uygulanır ("*.view_all" izinleri).
 */
export const PERMISSIONS = {
  "contacts.view": "Müşterileri görüntüle (kendine atanmış)",
  "contacts.view_all": "Tüm müşterileri görüntüle",
  "contacts.create": "Müşteri oluştur",
  "contacts.edit": "Müşteri düzenle",
  "contacts.delete": "Müşteri sil (arşivle)",
  "contacts.merge": "Müşteri kayıtlarını birleştir",
  "opportunities.view": "Fırsatları görüntüle (kendine atanmış)",
  "opportunities.view_all": "Tüm fırsatları görüntüle",
  "opportunities.create": "Fırsat oluştur",
  "opportunities.edit": "Fırsat düzenle / aşama değiştir",
  "opportunities.assign": "Fırsat sorumlusu ata",
  "opportunities.delete": "Fırsat sil (arşivle)",
  "projects.view": "Projeleri görüntüle (kendine atanmış)",
  "projects.view_all": "Tüm projeleri görüntüle",
  "projects.create": "Proje oluştur",
  "projects.edit": "Proje düzenle / aşama değiştir",
  "projects.approve_dates": "Sevkiyat/montaj tarihlerini teknik olarak onayla",
  "tasks.view_all": "Tüm görevleri görüntüle",
  "tasks.manage": "Görev oluştur / düzenle",
  "notes.write": "Not ve görüşme kaydı ekle",
  "files.upload": "Dosya yükle",
  "files.download": "Dosya indir",
  "files.delete": "Dosya sil",
  "quotes.view": "Teklifleri görüntüle (erişebildiği fırsat/müşteri)",
  "quotes.create": "Teklif hazırla / düzenle",
  "quotes.approve": "Teklifi onayla / reddet (gönderim öncesi)",
  "quotes.send": "Onaylı teklifi gönderildi olarak işaretle / müşteri yanıtını gir",
  "calendar.view": "Takvimi görüntüle (kendine atanmış)",
  "calendar.view_all": "Tüm randevuları görüntüle",
  "calendar.manage": "Randevu / keşif oluştur ve güncelle",
  "templates.manage": "Mesaj şablonlarını yönet",
  "reports.view": "Raporları görüntüle",
  "leads.view": "Gelen talepleri görüntüle",
  "leads.process": "Talepleri işle (fırsata dönüştür / reddet)",
  "data.export": "Veri dışa aktar (CSV)",
  "audit.view": "Denetim kaydını görüntüle",
  "integrations.view": "Entegrasyon günlüğünü görüntüle",
  "integrations.manage": "Entegrasyon işlerini yeniden dene / yönet",
  "users.manage": "Kullanıcı davet et / pasifleştir",
  "roles.manage": "Rol ve izinleri değiştir",
  "settings.manage": "Sistem ayarları",
} as const;

export type Permission = keyof typeof PERMISSIONS;
export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as Permission[];

/** Hiçbir rolde değiştirilemeyen izinler (yalnız SUPER_ADMIN). Kilitlenme / yetki yükseltme koruması. */
export const LOCKED_PERMISSIONS: Permission[] = ["roles.manage"];

export const ROLE_LABELS: Record<Role, string> = {
  SUPER_ADMIN: "Süper yönetici",
  MANAGER: "Yönetici",
  SALES: "Satış",
  DESIGN_TECHNICAL: "Tasarım / Teknik",
  PRODUCTION_INSTALLATION: "Üretim / Montaj",
  READ_ONLY: "Salt okunur",
};

export const ROLES = Object.keys(ROLE_LABELS) as Role[];

const sales: Permission[] = [
  "contacts.view", "contacts.create", "contacts.edit",
  "opportunities.view", "opportunities.create", "opportunities.edit",
  "projects.view", "projects.create",
  "tasks.manage", "notes.write", "files.upload", "files.download",
  "leads.view", "leads.process",
  "quotes.view", "quotes.create", "quotes.send",
  "calendar.view", "calendar.manage",
];

const technical: Permission[] = [
  "contacts.view", "opportunities.view",
  "projects.view", "projects.edit", "projects.approve_dates",
  "tasks.manage", "notes.write", "files.upload", "files.download",
  "quotes.view", "calendar.view", "calendar.manage",
];

const production: Permission[] = [
  "contacts.view", "projects.view", "projects.edit",
  "tasks.manage", "notes.write", "files.upload", "files.download",
  "calendar.view", "calendar.manage",
];

const readOnly: Permission[] = [
  "contacts.view", "contacts.view_all",
  "opportunities.view", "opportunities.view_all",
  "projects.view", "projects.view_all",
  "tasks.view_all", "leads.view", "files.download",
  "quotes.view", "calendar.view", "calendar.view_all", "reports.view",
];

const manager: Permission[] = ALL_PERMISSIONS.filter((p) => !LOCKED_PERMISSIONS.includes(p) && p !== "settings.manage");

export const DEFAULT_MATRIX: Record<Role, ReadonlySet<Permission>> = {
  SUPER_ADMIN: new Set(ALL_PERMISSIONS),
  MANAGER: new Set(manager),
  SALES: new Set(sales),
  DESIGN_TECHNICAL: new Set(technical),
  PRODUCTION_INSTALLATION: new Set(production),
  READ_ONLY: new Set(readOnly),
};

export type Override = { role: Role; permission: string; granted: boolean };

/** Varsayılan matris + yönetici değişiklikleri → rolün etkin izinleri. */
export function effectivePermissions(role: Role, overrides: Override[]): Set<Permission> {
  if (role === "SUPER_ADMIN") return new Set(ALL_PERMISSIONS);
  const set = new Set(DEFAULT_MATRIX[role]);
  for (const o of overrides) {
    if (o.role !== role) continue;
    if (!(o.permission in PERMISSIONS)) continue;
    const p = o.permission as Permission;
    if (LOCKED_PERMISSIONS.includes(p)) continue;
    if (o.granted) set.add(p);
    else set.delete(p);
  }
  return set;
}
