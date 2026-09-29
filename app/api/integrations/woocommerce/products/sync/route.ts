import { NextResponse } from "next/server";
import { authenticateWordPressRequest } from "@/lib/integrations/woocommerce/auth";
import { validateSyncRequest } from "@/lib/integrations/woocommerce/normalizer";
import { syncProducts, reconcileProducts } from "@/lib/integrations/woocommerce/sync";

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

    // DIAGNOSTIC: Log received stock data
    console.log("[STOCK DIAG] Received products:", body.products?.map((p: { externalId: string; name: string; stockQuantity: number | null; stockStatus: string; manageStock: boolean | undefined; type: string }) => ({
      externalId: p.externalId,
      name: p.name,
      stockQuantity: p.stockQuantity,
      stockStatus: p.stockStatus,
      manageStock: p.manageStock,
      type: p.type,
    })));

    const validation = validateSyncRequest(body);

    if (!validation.success) {
      return NextResponse.json(
        { error: "Invalid request", details: validation.errors },
        { status: 400 }
      );
    }

    // DIAGNOSTIC: Log normalized stock data
    console.log("[STOCK DIAG] Normalized products:", validation.products?.map((p) => ({
      externalId: p.externalId,
      name: p.name,
      stock: p.stock,
      type: p.type,
    })));

    // Sync products
    const result = await syncProducts(auth.tenantId!, validation.products!);

    // Reconcile: archive products not in this sync batch
    const syncedIds = validation.products!.map((p) => p.externalId);
    const reconciliation = await reconcileProducts(auth.tenantId!, syncedIds);

    // DIAGNOSTIC: Log sync result
    console.log("[STOCK DIAG] Sync result:", result);
    console.log("[STOCK DIAG] Reconciliation:", reconciliation);

    return NextResponse.json({
      success: true,
      ...result,
      archived: reconciliation.archived,
    });
  } catch (error) {
    console.error("[STOCK DIAG] Error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
