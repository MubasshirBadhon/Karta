import { NextResponse } from "next/server";
import { authenticateWordPressRequest } from "@/lib/integrations/woocommerce/auth";
import { linkVisitorToCustomer } from "@/lib/intelligence/identity-link";

/**
 * POST /api/integrations/woocommerce/customers
 *
 * WooCommerce customer identity sync / anonymous→customer merge.
 *
 * Called by the WordPress plugin (HMAC-authenticated) when the
 * WooCommerce integration provides customer information (account
 * creation, login, or an order completing with customer data).
 *
 * Body:
 * {
 *   "visitorId": "kvid_...",      // optional: the first-party visitor ID
 *   "wooCustomerId": "123",       // optional but one signal required
 *   "email": "...",               // optional
 *   "phone": "...",               // optional
 *   "name": "..."                 // optional
 * }
 *
 * Only reliable, authorized signals trigger a link. The visitor's
 * previous anonymous conversation history is preserved (re-linked, never
 * discarded). Tenant isolation is enforced.
 */
export async function POST(request: Request) {
  try {
    const connectionId = request.headers.get("X-Karta-Connection-Id");
    const timestamp = request.headers.get("X-Karta-Timestamp");
    const signature = request.headers.get("X-Karta-Signature");

    const auth = await authenticateWordPressRequest(connectionId, timestamp, signature);

    if (!auth.success) {
      return NextResponse.json({ error: auth.error }, { status: 401 });
    }

    const body = await request.json().catch(() => null);

    const result = await linkVisitorToCustomer(auth.tenantId!, {
      visitorId: typeof body?.visitorId === "string" ? body.visitorId : null,
      wooCustomerId:
        body?.wooCustomerId !== undefined && body?.wooCustomerId !== null
          ? String(body.wooCustomerId)
          : null,
      email: typeof body?.email === "string" ? body.email : null,
      phone: typeof body?.phone === "string" ? body.phone : null,
      name: typeof body?.name === "string" ? body.name : null,
    });

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    return NextResponse.json({
      success: true,
      customerId: result.customerId,
      linkedConversations: result.linkedConversations,
    });
  } catch (error) {
    console.error("[CUSTOMERS] Error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
