import Link from "next/link";
import QRCode from "qrcode";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { decrypt } from "@/lib/crypto";
import { requireActor } from "@/lib/rbac/guard";
import { getSession } from "@/lib/auth/session";
import { otpauthUrl } from "@/lib/auth/totp";
import { ROLE_LABELS } from "@/lib/rbac/permissions";
import { mailConfigured } from "@/lib/mailer";
import { fmtDateTime, fmtRelative } from "@/lib/format";
import { Badge, Card, DefList, PageHeader } from "@/components/ui/primitives";
import { buttonClass } from "@/components/ui/styles";
import { ConfirmMfaForm, DisableMfaForm, PasswordForm, StartMfaButton } from "./forms";
import { saveWebsiteOwner, revokeSession, toggleEmailNotifications } from "./actions";
import { userOptions } from "@/lib/queries";
import { inputClass } from "@/components/ui/styles";

export const metadata = { title: "Ayarlar" };

export default async function SettingsPage() {
  const actor = await requireActor();
  const current = await getSession();
  const [user, sessions, backup, websiteOwner, owners] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: actor.id }, select: { email: true, name: true, role: true, mfaEnabled: true, mfaSecretEnc: true, emailNotifications: true, lastLoginAt: true } }),
    prisma.session.findMany({ where: { userId: actor.id, revokedAt: null, expiresAt: { gt: new Date() } }, orderBy: { lastSeenAt: "desc" } }),
    actor.perms.has("settings.manage") ? prisma.setting.findUnique({ where: { key: "backup.last" } }) : null,
    actor.perms.has("settings.manage") ? prisma.setting.findUnique({ where: { key: "intake.website_owner_id" } }) : null,
    actor.perms.has("settings.manage") ? userOptions() : [],
  ]);
  const pendingSecret = !user.mfaEnabled && user.mfaSecretEnc ? decrypt(user.mfaSecretEnc, env().DATA_ENCRYPTION_KEY) : null;
  const qr = pendingSecret ? await QRCode.toDataURL(otpauthUrl(pendingSecret, user.email), { margin: 1, width: 200 }) : null;
  const e = env();
  const lastBackup = backup?.value as { at?: string; file?: string; sizeBytes?: number; restoreVerifiedAt?: string } | undefined;
  const exports = [
    { href: "/api/export/contacts", label: "Müşteriler" },
    { href: "/api/export/opportunities", label: "Fırsatlar" },
    { href: "/api/export/projects", label: "Projeler" },
    { href: "/api/export/tasks", label: "Görevler" },
    ...(actor.perms.has("audit.view") ? [{ href: "/api/export/audit", label: "Denetim kaydı" }] : []),
  ];

  return (
    <>
      <PageHeader title="Ayarlar" description="Hesap güvenliği, veri dışa aktarma ve sistem durumu." />
      <div className="grid gap-6 xl:grid-cols-2">
        <Card title="Hesap">
          <DefList
            items={[
              { label: "Ad", value: user.name },
              { label: "E-posta", value: user.email },
              { label: "Rol", value: ROLE_LABELS[user.role] },
              { label: "Son giriş", value: fmtDateTime(user.lastLoginAt) },
            ]}
          />
          <form action={toggleEmailNotifications} className="mt-4 flex flex-wrap items-center gap-3 border-t border-line pt-4 text-sm">
            <input type="hidden" name="on" value={user.emailNotifications ? "0" : "1"} />
            <span>
              Görev e-posta bildirimleri: <strong>{user.emailNotifications ? "Açık" : "Kapalı"}</strong>
              {!mailConfigured() ? <span className="block text-xs text-muted">SMTP yapılandırılınca gönderilir; şu an yalnız bildirim merkezi.</span> : null}
            </span>
            <button className={buttonClass("secondary", "sm")}>{user.emailNotifications ? "Kapat" : "Aç"}</button>
          </form>
        </Card>

        <Card title="Şifre">
          <PasswordForm email={user.email} />
        </Card>

        <Card title="İki adımlı doğrulama (MFA)">
          {user.mfaEnabled ? (
            <div className="space-y-4">
              <p className="text-sm">
                <Badge tone="success">Açık</Badge> Girişte doğrulama uygulaması kodu isteniyor.
              </p>
              <DisableMfaForm />
            </div>
          ) : pendingSecret && qr ? (
            <div className="space-y-4 text-sm">
              <p>Google Authenticator, Microsoft Authenticator veya 1Password ile QR kodu okutun, ardından üretilen kodu girin.</p>
              {/* eslint-disable-next-line @next/next/no-img-element -- yerel üretilmiş data URL */}
              <img src={qr} alt="MFA kurulum QR kodu" width={200} height={200} className="rounded-lg border border-line bg-white p-2" />
              <p className="text-xs text-muted">
                QR okutulamıyorsa elle girin: <code className="break-all rounded bg-surface-2 px-1.5 py-0.5 text-fg">{pendingSecret}</code>
              </p>
              <ConfirmMfaForm />
            </div>
          ) : (
            <div className="space-y-3 text-sm">
              <p className="text-muted">{actor.role === "SUPER_ADMIN" || actor.role === "MANAGER" ? "Yönetici hesapları için önerilir." : "Hesabınızı ek kodla koruyun."}</p>
              <StartMfaButton />
            </div>
          )}
        </Card>

        <Card title={`Açık oturumlar (${sessions.length})`} padded={false}>
          <ul className="divide-y divide-line">
            {sessions.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
                <span className="min-w-0">
                  <span className="block truncate">{s.userAgent ?? "Bilinmeyen cihaz"}</span>
                  <span className="block text-xs text-muted">
                    Açılış {fmtDateTime(s.createdAt)} · son etkinlik {fmtRelative(s.lastSeenAt)}
                  </span>
                </span>
                {s.id === current?.id ? (
                  <Badge tone="success">Bu cihaz</Badge>
                ) : (
                  <form action={revokeSession}>
                    <input type="hidden" name="id" value={s.id} />
                    <button className={buttonClass("secondary", "sm")}>Sonlandır</button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        </Card>

        {actor.perms.has("data.export") ? (
          <Card title="Veri dışa aktar (CSV)">
            <p className="mb-3 text-sm text-muted">Dışa aktarımlar yalnız erişim yetkinizdeki kayıtları içerir ve denetim kaydına yazılır. Excel uyumlu (UTF-8 BOM, noktalı virgül).</p>
            <div className="flex flex-wrap gap-2">
              {exports.map((x) => (
                <a key={x.href} href={x.href} className={buttonClass("secondary")}>
                  {x.label}
                </a>
              ))}
            </div>
          </Card>
        ) : null}

        {actor.perms.has("audit.view") ? (
          <Card title="Denetim kaydı">
            <p className="mb-3 text-sm text-muted">Giriş, dışa aktarım, birleştirme, rol değişimi, dosya indirme, silme ve diğer önemli işlemler.</p>
            <Link href="/ayarlar/denetim" className={buttonClass("secondary")}>
              Denetim kaydını aç
            </Link>
          </Card>
        ) : null}

        {actor.perms.has("settings.manage") ? (
          <>
            <Card title="Yedek durumu">
              {lastBackup?.at ? (
                <DefList
                  items={[
                    { label: "Son yedek", value: `${fmtDateTime(lastBackup.at)} (${fmtRelative(lastBackup.at)})` },
                    { label: "Dosya", value: lastBackup.file },
                    { label: "Boyut", value: lastBackup.sizeBytes ? `${(lastBackup.sizeBytes / 1024 / 1024).toFixed(1)} MB` : null },
                    { label: "Son restore doğrulaması", value: lastBackup.restoreVerifiedAt ? fmtDateTime(lastBackup.restoreVerifiedAt) : <span className="text-warning">Yapılmadı</span> },
                  ]}
                />
              ) : (
                <p className="rounded-lg bg-warning-soft p-3 text-sm text-warning">Bu ortam için kayıtlı yedek yok. Günlük şifreli yedek ve restore tatbikatı prosedürü docs/BACKUP_RESTORE.md içinde; sunucuda zamanlanınca burada görünür.</p>
              )}
              <p className="mt-3 text-xs text-muted">Neon PITR (anlık geri dönüş) sağlayıcı tarafında ayrıca açık olmalıdır; “yedek alındı” logu tek başına yeterli kabul edilmez.</p>
            </Card>
            <Card title="Web talepleri">
              <form action={saveWebsiteOwner} className="space-y-3">
                <label htmlFor="website-owner" className="block text-sm font-medium">
                  Sitedeki formlardan gelen talepler kime atansın?
                </label>
                <select id="website-owner" name="ownerId" defaultValue={typeof websiteOwner?.value === "string" ? websiteOwner.value : ""} className={inputClass(false)}>
                  <option value="">Atama yapma — yöneticilere bildir</option>
                  {owners.map((u) => (
                    <option key={u.value} value={u.value}>
                      {u.label}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-muted">Talep mevcut bir müşterinin açık fırsatına eklenirse o fırsatın sorumlusu korunur.</p>
                <button className={buttonClass("secondary", "sm")}>Kaydet</button>
              </form>
            </Card>
            <Card title="Sistem">
              <DefList
                items={[
                  { label: "Ortam", value: <Badge tone={e.APP_ENV === "production" ? "danger" : "info"}>{e.APP_ENV}</Badge> },
                  { label: "Dosya deposu", value: e.STORAGE_DRIVER === "s3" ? "S3 uyumlu özel bucket" : <span className="text-warning">Yerel özel dizin (geliştirme)</span> },
                  { label: "E-posta (SMTP)", value: mailConfigured() ? "Yapılandırıldı" : <span className="text-warning">Yapılandırılmadı</span> },
                  { label: "Virüs taraması", value: process.env.CLAMAV_HOST ? "ClamAV" : <span className="text-warning">Yapılandırılmadı</span> },
                  { label: "Saat dilimi", value: "Europe/Istanbul" },
                  { label: "Dosya boyut sınırı", value: `${e.MAX_UPLOAD_MB} MB` },
                ]}
              />
            </Card>
          </>
        ) : null}
      </div>
    </>
  );
}
