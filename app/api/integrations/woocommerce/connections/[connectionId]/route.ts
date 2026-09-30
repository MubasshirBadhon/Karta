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

    // Mark the connection inactive (soft disconnect) instead of
    // hard-deleting — the record is preserved for connection-scoped
    // product identity. Authentication is still revoked: the auth layer
    // rejects non-active connections, so the old credentials no longer
    // authenticate any Karta API call.
    await prisma.wooCommerceConnection.update({
      where: { id: connection.id },
      data: { status: "disconnected" },
    });

    // Archive the tenant's products (soft deletion) — a disconnected
    // store's products must no longer be exposed to the website AI.
    // Orders, conversations, and customers are NOT touched.
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
