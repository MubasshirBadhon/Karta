import { NextResponse } from "next/server";
import { authenticateWordPressRequest } from "@/lib/integrations/woocommerce/auth";

// ═══════════════════════════════════════════════════════════════════════════════
// TEMPORARY DIAGNOSTIC LOGGING - REMOVE AFTER DEBUGGING
// ═══════════════════════════════════════════════════════════════════════════════

function diagLog(message: string, data?: Record<string, unknown>) {
  const entry = {
    timestamp: new Date().toISOString(),
    source: "karta-auth-test-route",
    message,
    ...data,
  };
  console.log("[DIAG]", JSON.stringify(entry));
}

// ═══════════════════════════════════════════════════════════════════════════════

export async function POST(request: Request) {
  const startTime = Date.now();
  const connectionId = request.headers.get("X-Karta-Connection-Id");
  const timestamp = request.headers.get("X-Karta-Timestamp");
  const signature = request.headers.get("X-Karta-Signature");

  // DIAG: Log request arrival (safe fields only)
  diagLog("Request received", {
    method: request.method,
    url: request.url,
    connectionIdPrefix: connectionId ? connectionId.substring(0, 8) : null,
    hasTimestamp: !!timestamp,
    hasSignature: !!signature,
  });

  try {
    diagLog("Authentication started");

    const auth = await authenticateWordPressRequest(connectionId, timestamp, signature);

    diagLog("Authentication completed", {
      success: auth.success,
      error: auth.error,
      elapsedMs: Date.now() - startTime,
    });

    if (!auth.success) {
      diagLog("Returning 401", { error: auth.error });
      return NextResponse.json(
        { error: auth.error },
        { status: 401 }
      );
    }

    diagLog("Returning 200 success");
    return NextResponse.json({
      success: true,
      tenantId: auth.tenantId,
      connectionId: auth.connectionId,
    });
  } catch (error) {
    diagLog("Exception caught", {
      error: error instanceof Error ? error.message : "Unknown error",
      elapsedMs: Date.now() - startTime,
    });
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
