import { NextResponse } from "next/server";
import { processMessage } from "@/lib/ai/commerce-engine";
import { prisma } from "@/lib/db/prisma";

export async function POST(request: Request) {
  const body = await request.json();
  const { message } = body;

  const tenant = await prisma.tenant.findFirst({
    orderBy: { createdAt: "asc" },
  });

  if (!tenant) {
    return NextResponse.json({ error: "No tenant" }, { status: 500 });
  }

  const result = await processMessage(
    {
      tenantId: tenant.id,
      channel: "web",
      conversationId: "diag-test",
      text: message,
      timestamp: new Date().toISOString(),
    },
    []
  );

  return NextResponse.json({
    success: result.success,
    text: result.text,
    error: result.error,
    errorDetails: result.errorDetails,
    toolCalls: result.toolCalls,
  });
}
