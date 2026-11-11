/**
 * İlk süper yöneticiyi oluşturur ve tek kullanımlık şifre belirleme bağlantısı üretir.
 * Şifre komut satırından alınmaz/loglanmaz; kullanıcı bağlantıdan kendisi belirler.
 *
 *   npm run user:create-admin -- --email=ad@bifiresomine.com --name="Ad Soyad"
 */
import "dotenv/config";
import { randomBytes, createHash } from "node:crypto";
import { prisma } from "@/lib/db";
import { normalizeEmail } from "@/lib/normalize";

function arg(name: string) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit?.slice(name.length + 3);
}

async function main() {
  const email = normalizeEmail(arg("email"));
  const name = arg("name")?.trim();
  if (!email || !name) throw new Error('Kullanım: npm run user:create-admin -- --email=ad@ornek.com --name="Ad Soyad"');
  const appUrl = process.env.APP_URL;
  if (!appUrl) throw new Error("APP_URL tanımlı değil");

  const existing = await prisma.user.findUnique({ where: { email } });
  const user = existing
    ? await prisma.user.update({ where: { id: existing.id }, data: { role: "SUPER_ADMIN", status: existing.status === "DISABLED" ? "INVITED" : existing.status } })
    : await prisma.user.create({ data: { email, name, role: "SUPER_ADMIN", status: "INVITED" } });

  const token = randomBytes(32).toString("base64url");
  await prisma.authToken.updateMany({ where: { userId: user.id, usedAt: null }, data: { usedAt: new Date() } });
  await prisma.authToken.create({
    data: { userId: user.id, type: user.passwordHash ? "PASSWORD_RESET" : "INVITE", tokenHash: createHash("sha256").update(token).digest("hex"), expiresAt: new Date(Date.now() + 24 * 3600_000) },
  });
  await prisma.auditLog.create({ data: { action: "user_invited", entityType: "user", entityId: user.id, summary: `${email} süper yönetici (CLI)` } });
  console.log(`Süper yönetici hazır: ${email}`);
  console.log(`Şifre belirleme bağlantısı (24 saat, tek kullanım):\n${appUrl}/sifre-belirle?token=${token}`);
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
