import { NextResponse } from "next/server";
import { authenticateWordPressRequest } from "@/lib/integrations/woocommerce/auth";

export async function POST(request: Request) {
  try {
    const connectionId = request.headers.get("X-Karta-Connection-Id");
    const timestamp = request.headers.get("X-Karta-Timestamp");
    const signature = request.headers.get("X-Karta-Signature");

    const auth = await authenticateWordPressRequest(connectionId, timestamp, signature);

    if (!auth.success) {
      return NextResponse.json(
        { error: auth.error },
        { status: 401 }
      );
    }

    return NextResponse.json({
      success: true,
      tenantId: auth.tenantId,
      connectionId: auth.connectionId,
    });
  } catch {
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
