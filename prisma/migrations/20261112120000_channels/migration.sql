-- Faz 4: kanallar (WhatsApp/Instagram yazışmaları, WhatsApp şablon kopyası, şifreli OAuth kimlik bilgisi, Google Takvim sağlayıcısı).
-- Yalnız EKLEYİCİ değişiklik. Geri alma: DROP TABLE messages, conversations, whatsapp_templates, integration_credentials; DROP TYPE "MessageStatus", "MessageDirection", "MessageChannel" (enum değeri kalabilir).
-- CreateEnum
CREATE TYPE "MessageChannel" AS ENUM ('WHATSAPP', 'INSTAGRAM');

-- CreateEnum
CREATE TYPE "MessageDirection" AS ENUM ('INBOUND', 'OUTBOUND');

-- CreateEnum
CREATE TYPE "MessageStatus" AS ENUM ('RECEIVED', 'QUEUED', 'SENDING', 'SENT', 'DELIVERED', 'READ', 'FAILED');

-- AlterEnum
ALTER TYPE "IntegrationProvider" ADD VALUE 'GOOGLE_CALENDAR';

-- CreateTable
CREATE TABLE "conversations" (
    "id" UUID NOT NULL,
    "channel" "MessageChannel" NOT NULL,
    "externalThreadId" TEXT NOT NULL,
    "displayName" TEXT,
    "phone" TEXT,
    "contactId" UUID,
    "leadId" UUID,
    "assignedUserId" UUID,
    "lastMessageAt" TIMESTAMPTZ,
    "lastInboundAt" TIMESTAMPTZ,
    "unreadCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messages" (
    "id" UUID NOT NULL,
    "conversationId" UUID NOT NULL,
    "direction" "MessageDirection" NOT NULL,
    "externalMessageId" TEXT,
    "type" TEXT NOT NULL,
    "body" TEXT,
    "templateId" UUID,
    "templateParams" JSONB,
    "status" "MessageStatus" NOT NULL,
    "error" TEXT,
    "sentById" UUID,
    "occurredAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whatsapp_templates" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "paramCount" INTEGER NOT NULL DEFAULT 0,
    "externalId" TEXT,
    "syncedAt" TIMESTAMPTZ NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "whatsapp_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration_credentials" (
    "id" UUID NOT NULL,
    "provider" "IntegrationProvider" NOT NULL,
    "key" TEXT NOT NULL,
    "ciphertext" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ,
    "createdById" UUID,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "integration_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "conversations_lastMessageAt_idx" ON "conversations"("lastMessageAt");

-- CreateIndex
CREATE INDEX "conversations_contactId_idx" ON "conversations"("contactId");

-- CreateIndex
CREATE UNIQUE INDEX "conversations_channel_externalThreadId_key" ON "conversations"("channel", "externalThreadId");

-- CreateIndex
CREATE INDEX "messages_externalMessageId_idx" ON "messages"("externalMessageId");

-- CreateIndex
CREATE INDEX "messages_conversationId_occurredAt_idx" ON "messages"("conversationId", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "messages_conversationId_externalMessageId_key" ON "messages"("conversationId", "externalMessageId");

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_templates_name_language_key" ON "whatsapp_templates"("name", "language");

-- CreateIndex
CREATE UNIQUE INDEX "integration_credentials_provider_key_key" ON "integration_credentials"("provider", "key");

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

