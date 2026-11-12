import type {
  ActivityType,
  MessageChannel,
  MessageStatus,
  AttachmentKind,
  ChimneyStatus,
  FireplaceType,
  GlassOrientation,
  LeadSource,
  LeadStatus,
  OpportunityStage,
  PreferredChannel,
  ProjectStage,
  TaskPriority,
  TaskStatus,
  UserStatus,
  JobStatus,
  IntegrationEventStatus,
  IntegrationProvider,
  ConnectionStatus,
  QuoteStatus,
  AppointmentType,
  AppointmentStatus,
  TemplateChannel,
} from "@prisma/client";

export const SOURCE_LABELS: Record<LeadSource, string> = {
  WEBSITE_CONTACT: "Web · İletişim formu",
  WEBSITE_QUOTE: "Web · Teklif formu",
  WEBSITE_SHOWROOM: "Web · Showroom formu",
  WEBSITE_DESIGN: "Web · Özel tasarım formu",
  INSTAGRAM_LEAD_AD: "Instagram reklam formu",
  FACEBOOK_LEAD_AD: "Facebook reklam formu",
  WHATSAPP: "WhatsApp",
  INSTAGRAM_DM: "Instagram mesajı",
  PHONE: "Telefon",
  SHOWROOM: "Showroom ziyareti",
  REFERRAL: "Referans",
  MANUAL: "Manuel kayıt",
  OTHER: "Diğer",
};

export const LEAD_STATUS_LABELS: Record<LeadStatus, string> = {
  RECEIVED: "Yeni",
  CONVERTED: "Fırsata dönüştü",
  DUPLICATE: "Mükerrer",
  DISCARDED: "Reddedildi",
};

export const STAGE_LABELS: Record<OpportunityStage, string> = {
  NEW: "Yeni",
  CONTACT_PENDING: "İletişim bekliyor",
  CONTACTED: "İletişime geçildi",
  NEEDS_ASSESSMENT: "İhtiyaç analizi",
  SHOWROOM_OR_SURVEY: "Showroom / Keşif",
  TECHNICAL_REVIEW: "Teknik inceleme",
  QUOTATION_PREPARING: "Teklif hazırlanıyor",
  QUOTATION_SENT: "Teklif gönderildi",
  NEGOTIATION: "Pazarlık",
  WON: "Kazanıldı",
  LOST: "Kaybedildi",
};

export const STAGE_ORDER: OpportunityStage[] = [
  "NEW",
  "CONTACT_PENDING",
  "CONTACTED",
  "NEEDS_ASSESSMENT",
  "SHOWROOM_OR_SURVEY",
  "TECHNICAL_REVIEW",
  "QUOTATION_PREPARING",
  "QUOTATION_SENT",
  "NEGOTIATION",
  "WON",
  "LOST",
];

export const PROJECT_STAGE_LABELS: Record<ProjectStage, string> = {
  TECHNICAL_APPROVAL: "Teknik onay",
  DESIGN_APPROVAL: "Tasarım onayı",
  ORDER_CONFIRMED: "Sipariş onaylandı",
  PRODUCTION_PLANNING: "Üretim planlama",
  IN_PRODUCTION: "Üretimde",
  READY_FOR_SHIPMENT: "Sevkiyata hazır",
  SHIPPED: "Sevk edildi",
  INSTALLATION_SCHEDULED: "Montaj planlandı",
  INSTALLED: "Montaj yapıldı",
  COMPLETED: "Tamamlandı",
  ON_HOLD: "Beklemede",
  CANCELLED: "İptal",
};

export const PROJECT_STAGE_ORDER: ProjectStage[] = [
  "TECHNICAL_APPROVAL",
  "DESIGN_APPROVAL",
  "ORDER_CONFIRMED",
  "PRODUCTION_PLANNING",
  "IN_PRODUCTION",
  "READY_FOR_SHIPMENT",
  "SHIPPED",
  "INSTALLATION_SCHEDULED",
  "INSTALLED",
  "COMPLETED",
  "ON_HOLD",
  "CANCELLED",
];

export const ACTIVE_PROJECT_STAGES: ProjectStage[] = [
  "ORDER_CONFIRMED",
  "PRODUCTION_PLANNING",
  "IN_PRODUCTION",
  "READY_FOR_SHIPMENT",
  "SHIPPED",
  "INSTALLATION_SCHEDULED",
];

export const FIREPLACE_LABELS: Record<FireplaceType, string> = {
  WOOD: "Odunlu",
  ELECTRIC: "Elektrikli",
  BIOETHANOL: "Bioethanol",
  GAS: "Gazlı",
  GARDEN: "Bahçe şöminesi",
  BARBECUE: "Barbekü",
  OTHER: "Diğer",
};

export const CHIMNEY_LABELS: Record<ChimneyStatus, string> = {
  EXISTS: "Baca var",
  NONE: "Baca yok",
  NEEDS_WORK: "Baca düzenleme gerekli",
  UNKNOWN: "Bilinmiyor",
};

export const GLASS_LABELS: Record<GlassOrientation, string> = {
  FRONT: "Tek cephe (ön)",
  LEFT_CORNER: "Sol köşe",
  RIGHT_CORNER: "Sağ köşe",
  DOUBLE_SIDED: "Çift taraflı",
  THREE_SIDED: "Üç taraflı",
  OTHER: "Diğer",
};

export const CHANNEL_LABELS: Record<PreferredChannel, string> = {
  PHONE: "Telefon",
  WHATSAPP: "WhatsApp",
  EMAIL: "E-posta",
  ANY: "Fark etmez",
};

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  OPEN: "Açık",
  IN_PROGRESS: "Devam ediyor",
  DONE: "Tamamlandı",
  CANCELLED: "İptal",
};

export const PRIORITY_LABELS: Record<TaskPriority, string> = {
  LOW: "Düşük",
  NORMAL: "Normal",
  HIGH: "Yüksek",
  URGENT: "Acil",
};

export const ACTIVITY_LABELS: Record<ActivityType, string> = {
  CALL: "Telefon görüşmesi",
  MEETING: "Toplantı",
  SHOWROOM_VISIT: "Showroom ziyareti",
  SITE_VISIT: "Keşif / saha ziyareti",
  WHATSAPP: "WhatsApp",
  INSTAGRAM: "Instagram",
  EMAIL: "E-posta",
  STAGE_CHANGE: "Aşama değişimi",
  ASSIGNMENT: "Sorumlu ataması",
  FILE: "Dosya",
  TASK: "Görev",
  SYSTEM: "Sistem",
};

/** Kullanıcının elle kaydedebileceği görüşme türleri. */
export const LOGGABLE_ACTIVITIES: ActivityType[] = ["CALL", "MEETING", "SHOWROOM_VISIT", "SITE_VISIT", "WHATSAPP", "INSTAGRAM", "EMAIL"];

export const ATTACHMENT_KIND_LABELS: Record<AttachmentKind, string> = {
  PHOTO: "Fotoğraf",
  DRAWING: "Çizim",
  QUOTE: "Teklif",
  CONTRACT: "Sözleşme",
  SURVEY_REPORT: "Keşif tutanağı",
  INSTALLATION_REPORT: "Montaj tutanağı",
  OTHER: "Diğer",
};

export const USER_STATUS_LABELS: Record<UserStatus, string> = {
  INVITED: "Davet edildi",
  ACTIVE: "Aktif",
  DISABLED: "Pasif",
};

export const LOST_REASONS = [
  "Fiyat yüksek bulundu",
  "Rakibi tercih etti",
  "Proje ertelendi / iptal",
  "Teknik olarak uygun değil",
  "Ulaşılamadı",
  "Bütçe yok",
  "Diğer",
];

export const JOB_STATUS_LABELS: Record<JobStatus | IntegrationEventStatus, string> = {
  RECEIVED: "Alındı",
  PENDING: "Bekliyor",
  PROCESSING: "İşleniyor",
  SUCCESS: "Başarılı",
  RETRY: "Yeniden denenecek",
  FAILED: "Başarısız",
  DEAD_LETTER: "Kalıcı hata (dead-letter)",
};

export const PROVIDER_LABELS: Record<IntegrationProvider, string> = {
  BIFIRE_WEBSITE: "Bifire web sitesi formları",
  META_LEAD_ADS: "Meta (Facebook/Instagram) Lead Ads",
  WHATSAPP: "WhatsApp Business Platform",
  INSTAGRAM_DM: "Instagram mesajları",
  SMTP: "E-posta (SMTP) — ekip bildirimleri",
  GOOGLE_CALENDAR: "Google Takvim",
};

export const MESSAGE_CHANNEL_LABELS: Record<MessageChannel, string> = { WHATSAPP: "WhatsApp", INSTAGRAM: "Instagram" };

export const MESSAGE_STATUS_LABELS: Record<MessageStatus, string> = {
  RECEIVED: "Alındı",
  QUEUED: "Sırada",
  SENDING: "Gönderiliyor",
  SENT: "Gönderildi",
  DELIVERED: "İletildi",
  READ: "Okundu",
  FAILED: "Başarısız",
};

export const WA_TEMPLATE_CATEGORY_LABELS: Record<string, string> = { MARKETING: "Pazarlama", UTILITY: "Hizmet", AUTHENTICATION: "Doğrulama" };

export const CONNECTION_STATUS_LABELS: Record<ConnectionStatus, string> = {
  NOT_CONFIGURED: "Yapılandırılmadı",
  ACTIVE: "Aktif",
  ERROR: "Hata",
  DISABLED: "Kapalı",
};

export const AUDIT_ACTION_LABELS: Record<string, string> = {
  whatsapp_send: "WhatsApp şablonu gönderildi",
  whatsapp_template_sync: "WhatsApp şablon senkronu istendi",
  conversation_assign: "Yazışma atandı",
  google_calendar_connect: "Google Takvim bağlandı",
  google_calendar_connect_failed: "Google Takvim bağlantısı başarısız",
  google_calendar_disconnect: "Google Takvim bağlantısı kaldırıldı",
  login: "Giriş",
  login_failed: "Başarısız giriş",
  logout: "Çıkış",
  mfa_enabled: "MFA açıldı",
  mfa_disabled: "MFA kapatıldı",
  password_reset_requested: "Şifre sıfırlama istendi",
  password_set: "Şifre belirlendi",
  sessions_revoked: "Oturumlar sonlandırıldı",
  user_invited: "Kullanıcı davet edildi",
  user_updated: "Kullanıcı güncellendi",
  role_change: "Rol değişti",
  permission_change: "İzin değişti",
  contact_created: "Müşteri oluşturuldu",
  contact_updated: "Müşteri güncellendi",
  contact_deleted: "Müşteri arşivlendi",
  merge: "Müşteri birleştirildi",
  opportunity_created: "Fırsat oluşturuldu",
  opportunity_updated: "Fırsat güncellendi",
  opportunity_stage: "Fırsat aşaması",
  opportunity_assigned: "Fırsat sorumlusu",
  opportunity_deleted: "Fırsat arşivlendi",
  project_created: "Proje oluşturuldu",
  project_updated: "Proje güncellendi",
  project_stage: "Proje aşaması",
  project_dates_approved: "Proje tarihleri onaylandı",
  task_created: "Görev oluşturuldu",
  task_updated: "Görev güncellendi",
  file_upload: "Dosya yüklendi",
  file_download: "Dosya indirildi",
  file_delete: "Dosya silindi",
  export: "Dışa aktarım",
  import: "İçe aktarım",
  lead_converted: "Talep dönüştürüldü",
  lead_discarded: "Talep reddedildi",
  integration_retry: "Entegrasyon yeniden denendi",
  settings_updated: "Ayar değişti",
  setting_changed: "Ayar değişti",
  lead_received: "Talep alındı (bekliyor)",
  quote_created: "Teklif oluşturuldu",
  quote_updated: "Teklif güncellendi",
  quote_submitted: "Teklif onaya gönderildi",
  quote_approval: "Teklif onay kararı",
  quote_sent: "Teklif gönderildi",
  quote_response: "Teklif müşteri yanıtı",
  quote_revised: "Teklif revize edildi",
  quote_deleted: "Teklif taslağı silindi",
  quote_pdf: "Teklif PDF'i indirildi",
  appointment_created: "Randevu oluşturuldu",
  appointment_updated: "Randevu güncellendi",
  appointment_status: "Randevu durumu değişti",
  template_saved: "Mesaj şablonu kaydedildi",
  report_view: "Rapor görüntülendi",
};

export const QUOTE_STATUS_LABELS: Record<QuoteStatus, string> = {
  DRAFT: "Taslak",
  PENDING_APPROVAL: "Onay bekliyor",
  APPROVED: "Onaylandı",
  SENT: "Gönderildi",
  ACCEPTED: "Kabul edildi",
  REJECTED: "Müşteri reddetti",
};

export const QUOTE_STATUS_TONE: Record<QuoteStatus, "neutral" | "warning" | "info" | "success" | "danger" | "accent"> = {
  DRAFT: "neutral",
  PENDING_APPROVAL: "warning",
  APPROVED: "info",
  SENT: "accent",
  ACCEPTED: "success",
  REJECTED: "danger",
};

export const QUOTE_UNITS = ["adet", "takım", "m", "m²", "m³", "kg", "saat", "gün", "hizmet"] as const;
export const TAX_RATES = ["20", "10", "1", "0"] as const;

export const APPOINTMENT_TYPE_LABELS: Record<AppointmentType, string> = {
  SHOWROOM_VISIT: "Showroom ziyareti",
  SITE_SURVEY: "Keşif (ölçü)",
  INSTALLATION: "Montaj",
  MEETING: "Toplantı / görüşme",
};

export const APPOINTMENT_STATUS_LABELS: Record<AppointmentStatus, string> = {
  REQUESTED: "Talep edildi",
  PROPOSED: "Saat önerildi",
  CONFIRMED: "Onaylandı",
  COMPLETED: "Tamamlandı",
  CANCELLED: "İptal",
  NO_SHOW: "Gelmedi",
};

export const APPOINTMENT_STATUS_TONE: Record<AppointmentStatus, "neutral" | "warning" | "info" | "success" | "danger" | "accent"> = {
  REQUESTED: "warning",
  PROPOSED: "info",
  CONFIRMED: "accent",
  COMPLETED: "success",
  CANCELLED: "neutral",
  NO_SHOW: "danger",
};

export const TEMPLATE_CHANNEL_LABELS: Record<TemplateChannel, string> = {
  EMAIL: "E-posta",
  WHATSAPP: "WhatsApp",
  SMS: "SMS",
};
