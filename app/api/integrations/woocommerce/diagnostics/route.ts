import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { authenticateWordPressRequest } from "@/lib/integrations/woocommerce/auth";
import { getEventCounts } from "@/lib/intelligence/events";

/**
 * GET /api/integrations/woocommerce/diagnostics
 *
 * Merchant/admin diagnostic capability (HMAC-authenticated, called by the
 * plugin's Settings → Karta → Diagnostics). Verifies the commerce
 * foundation without exposing ANY secrets:
 *
 *  1. Karta API connectivity (this endpoint responding = connected)
 *  2. Woo connection (status)
 *  3. last successful sync (the connection record's lastSyncAt)
 *  4. product count (all)
 *  5. active product count
 *  6. archived product count
 *  7. inventory mode
 *  8. cart store entries (persistent WhatsApp carts)
 *  9. WhatsApp connection status (configuration only — no tokens)
 * 10. customer intelligence counts
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

    const tenantId = auth.tenantId!;

    const [connection, productCount, activeCount, archivedCount, cartCount, whatsApp, eventCounts, tenant] =
      await Promise.all([
        prisma.wooCommerceConnection.findFirst({
          where: { tenantId },
          select: { connectionId: true, siteUrl: true, siteName: true, status: true, lastSyncAt: true },
        }),
        prisma.product.count({ where: { tenantId } }),
        prisma.product.count({ where: { tenantId, status: "active" } }),
        prisma.product.count({ where: { tenantId, status: "archived" } }),
        prisma.wooCustomerCart.count({ where: { tenantId } }),
        prisma.whatsAppConnection.findFirst({
          where: { tenantId },
          select: { status: true, displayPhoneNumber: true },
        }),
        getEventCounts(tenantId),
        prisma.tenant.findUnique({
          where: { id: tenantId },
          select: { inventoryMode: true },
        }),
      ]);

    return NextResponse.json({
      success: true,
      kartaApi: "connected",
      connection: connection
        ? {
            status: connection.status,
            siteUrl: connection.siteUrl,
            siteName: connection.siteName,
            lastSyncAt: connection.lastSyncAt,
          }
        : null,
      products: {
        total: productCount,
        active: activeCount,
        archived: archivedCount,
      },
      inventoryMode: tenant?.inventoryMode ?? "unlimited",
      cartStore: { entries: cartCount },
      whatsApp: whatsApp
        ? { status: whatsApp.status, displayPhoneNumber: whatsApp.displayPhoneNumber }
        : { status: "not_configured" },
      intelligence: eventCounts,
      checkedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("[DIAGNOSTICS] Error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
