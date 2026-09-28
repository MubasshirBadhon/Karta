import { NextResponse } from "next/server";
import { authenticateWordPressRequest } from "@/lib/integrations/woocommerce/auth";
import { validateSyncRequest } from "@/lib/integrations/woocommerce/normalizer";
import { syncProducts } from "@/lib/integrations/woocommerce/sync";

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

    // Parse and validate the request body
    const body = await request.json();
    const validation = validateSyncRequest(body);

    if (!validation.success) {
      return NextResponse.json(
        { error: "Invalid request", details: validation.errors },
        { status: 400 }
      );
    }

    // Sync products
    const result = await syncProducts(auth.tenantId!, validation.products!);

    return NextResponse.json({
      success: true,
      ...result,
    });
  } catch {
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
