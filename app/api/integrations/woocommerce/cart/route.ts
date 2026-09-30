import { NextResponse } from "next/server";
import { authenticateWordPressRequest } from "@/lib/integrations/woocommerce/auth";
import { getCartByToken } from "@/lib/commerce/woo-cart-store";

/**
 * GET /api/integrations/woocommerce/cart?token=...
 *
 * Called by the WordPress plugin's cart-restore handler when a WhatsApp
 * customer opens their personal cart link (?karta-cart=<cartToken>).
 * Returns the stored cart items so the plugin can materialize them into
 * the visitor's REAL WooCommerce session cart with Woo-native APIs.
 *
 * HMAC-authenticated (server-to-server): the WooCommerce connection
 * secret never appears in the customer-facing link.
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

    const token = new URL(request.url).searchParams.get("token") || "";
    if (!token) {
      return NextResponse.json({ error: "Cart token is required" }, { status: 400 });
    }

    const cart = await getCartByToken(token);

    if (!cart) {
      return NextResponse.json({ error: "Cart not found" }, { status: 404 });
    }

    // Tenant isolation: the cart must belong to the requesting connection's tenant
    if (cart.tenantId !== auth.tenantId) {
      return NextResponse.json({ error: "Cart not found" }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      cartToken: cart.cartToken,
      items: cart.items,
      itemCount: cart.itemCount,
      total: cart.total,
    });
  } catch (error) {
    console.error("[CART] Error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
