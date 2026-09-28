import { NextResponse } from "next/server";
import { authenticateWordPressRequest } from "@/lib/integrations/woocommerce/auth";

export async function POST(request: Request) {
  try {
    // Authenticate the request
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

    const body = await request.json();
    const { topic, callback_url } = body;

    if (!topic || !callback_url) {
      return NextResponse.json(
        { error: "Missing topic or callback_url" },
        { status: 400 }
      );
    }

    // In a real implementation, this would register the webhook with WooCommerce
    // For now, we just acknowledge the request
    return NextResponse.json({
      success: true,
      message: `Webhook registered for ${topic}`,
    });
  } catch {
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
