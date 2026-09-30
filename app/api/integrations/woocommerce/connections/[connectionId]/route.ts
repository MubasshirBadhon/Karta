import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { getOrCreateDemoTenant } from "@/lib/tenant/resolution";

const ConnectionIdSchema = z.object({
  connectionId: z.string().min(1),
});

/**
 * DELETE /api/integrations/woocommerce/connections/[connectionId]
 *
 * Safely removes a WooCommerce connection.
 * - Validates the connection belongs to the current tenant
 * - Does NOT delete products, orders, or customers
 * - Revokes the connection so old credentials no longer authenticate
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ connectionId: string }> }
) {
  try {
    const { connectionId } = await params;
    const parsed = ConnectionIdSchema.safeParse({ connectionId });

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid connection ID" },
        { status: 400 }
      );
    }

    // Resolve demo tenant server-side
    const tenant = await getOrCreateDemoTenant();

    if (!tenant) {
      return NextResponse.json(
        { error: "Demo tenant not available" },
        { status: 500 }
      );
    }

    // Verify the connection exists and belongs to this tenant
    const connection = await prisma.wooCommerceConnection.findUnique({
      where: { connectionId: parsed.data.connectionId },
    });

    if (!connection) {
      return NextResponse.json(
        { error: "Connection not found" },
        { status: 404 }
      );
    }

    if (connection.tenantId !== tenant.id) {
      return NextResponse.json(
        { error: "Connection not found" },
        { status: 404 }
      );
    }

    // Delete the connection record
    // This revokes authentication — old connectionId/secret will no longer work
    // Products, orders, and customers are NOT deleted (hard deletion)
    await prisma.wooCommerceConnection.delete({
      where: { id: connection.id },
    });

    // Archive the tenant's products (soft deletion) — a disconnected
    // store's products must no longer be exposed to the website AI.
    // Orders/conversations may still reference them, so products are
    // archived (status="archived"), never hard-deleted.
    await prisma.product.updateMany({
      where: { tenantId: tenant.id, status: { not: "archived" } },
      data: { status: "archived" },
    });

    return NextResponse.json({
      success: true,
      message: "Connection removed successfully",
    });
  } catch {
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
