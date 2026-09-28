import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";

export async function GET() {
  const health: Record<string, unknown> = {
    status: "ok",
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version || "0.1.0",
  };

  // Database health check
  try {
    await prisma.$queryRaw`SELECT 1`;
    health.database = "connected";
  } catch {
    health.database = "disconnected";
    health.status = "degraded";
  }

  // AI provider check (configuration only, no API call)
  health.aiProvider = process.env.GROQ_API_KEY ? "configured" : "not_configured";

  // WhatsApp provider check (configuration only)
  health.whatsApp = process.env.WHATSAPP_ACCESS_TOKEN ? "configured" : "not_configured";

  const statusCode = health.status === "ok" ? 200 : 503;

  return NextResponse.json(health, { status: statusCode });
}
