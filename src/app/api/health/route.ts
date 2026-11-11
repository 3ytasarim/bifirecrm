import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

/** Uptime izleme ucu: DB erişimi + kuyruk durumu. Sır veya ayrıntılı hata döndürmez. */
export async function GET() {
  const started = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    const [dead, stuck] = await Promise.all([
      prisma.integrationJob.count({ where: { status: "DEAD_LETTER" } }),
      prisma.integrationJob.count({ where: { status: "PROCESSING", lockedAt: { lt: new Date(Date.now() - 10 * 60_000) } } }),
    ]);
    return NextResponse.json({ status: "ok", db: "ok", deadLetterJobs: dead, stuckJobs: stuck, latencyMs: Date.now() - started }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ status: "error", db: "unreachable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
