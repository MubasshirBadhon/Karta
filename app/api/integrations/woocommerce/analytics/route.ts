import { NextResponse } from "next/server";
import { authenticateWordPressRequest } from "@/lib/integrations/woocommerce/auth";
import { getEventCounts } from "@/lib/intelligence/events";

/**
 * GET /api/integrations/woocommerce/analytics
 *
 * Merchant-facing customer intelligence counts (HMAC-authenticated,
 * tenant-isolated). First implementation: aggregated counts only.
 * No revenue attribution is claimed unless the event chain proves it.
 */
export async function GET(request: Request) {
  try {
    const connectionId = request.headers.get("X-Karta-Connection-Id");
    const timestamp = request.headers.get("X-Karta-Timestamp");
    const signature = request.headers.get("X-Karta-Signature");

    const auth = await authenticateWordPressRequest(connectionId, timestamp, signature);

    if (!auth.success) {
      return NextResponse.json({ error: auth.error }, { status: 401 });
    }

    const counts = await getEventCounts(auth.tenantId!);

    return NextResponse.json({ success: true, ...counts });
  } catch (error) {
    console.error("[ANALYTICS] Error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
