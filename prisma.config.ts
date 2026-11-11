import "dotenv/config";
import { defineConfig } from "prisma/config";

// Prisma CLI (migrate/studio) doğrudan (pooler'sız) bağlantıyı kullanır; uygulama çalışma zamanında
// src/lib/db.ts üzerinden pooled DATABASE_URL ile bağlanır.
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: process.env.DIRECT_URL ?? process.env.DATABASE_URL,
  },
});
