import { NextResponse } from "next/server";
import { authenticateWordPressRequest } from "@/lib/integrations/woocommerce/auth";
import { validateSyncRequest } from "@/lib/integrations/woocommerce/normalizer";
import { syncProducts, reconcileProducts } from "@/lib/integrations/woocommerce/sync";

/**
 * POST /api/integrations/woocommerce/products/sync
 *
 * Product sync endpoint (called by the WordPress plugin, HMAC-authenticated).
 *
 * The plugin syncs in batches (BATCH_SIZE products per request) and marks
 * the LAST batch with sync.isFinalBatch=true, including the complete list
 * of external IDs seen across the whole sync (sync.seenExternalIds).
 *
 * RECONCILIATION ONLY AFTER THE FULL SYNC SUCCEEDS:
 * - Reconciliation (archiving products not seen in the completed sync)
 *   runs ONLY on the final batch.
 * - If the Woo API fails halfway through, the plugin aborts and never
 *   sends isFinalBatch — so products are NEVER archived just because
 *   they were not seen in a partial sync.
 * - Requests without the final-batch signal (e.g. older plugin versions)
 *   only upsert products; nothing is archived.
 */
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

    // Sync products (scoped to this Woo connection)
    const result = await syncProducts(auth.tenantId!, auth.connectionId!, validation.products ?? []);

    // Batch metadata from the plugin
    const isFinalBatch = body?.sync?.isFinalBatch === true;
    const seenExternalIds: string[] =
      Array.isArray(body?.sync?.seenExternalIds) && body.sync.seenExternalIds.length > 0
        ? body.sync.seenExternalIds
        : (validation.products ?? []).map((p: { externalId: string }) => p.externalId);

    let archived = 0;

    if (isFinalBatch) {
      // Full sync completed successfully — archive previously-active
      // products that were NOT seen in this completed sync.
      const reconciliation = await reconcileProducts(
        auth.tenantId!,
        auth.connectionId!,
        seenExternalIds
      );
      archived = reconciliation.archived;
    }

    return NextResponse.json({
      success: true,
      ...result,
      archived,
      isFinalBatch,
    });
  } catch (error) {
    console.error("[SYNC] Error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
