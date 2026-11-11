-- Faz 2: web sitesi aktarımı. Yalnız EKLEYİCİ değişiklik (geri alma: DROP TABLE webhook_nonces; enum değeri kalabilir).
ALTER TYPE "LeadSource" ADD VALUE IF NOT EXISTS 'WEBSITE_CONTACT' BEFORE 'WEBSITE_QUOTE';

CREATE TABLE "webhook_nonces" (
    "nonce" TEXT NOT NULL,
    "provider" "IntegrationProvider" NOT NULL,
    "expiresAt" TIMESTAMPTZ NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "webhook_nonces_pkey" PRIMARY KEY ("nonce")
);

CREATE INDEX "webhook_nonces_expiresAt_idx" ON "webhook_nonces"("expiresAt");
