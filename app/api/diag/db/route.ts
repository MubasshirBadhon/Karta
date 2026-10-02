import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { authenticateWordPressRequest } from "@/lib/integrations/woocommerce/auth";

/**
 * GET /api/diag/db
 *
 * Tenant/product diagnostic dump — HMAC-AUTHENTICATED.
 *
 * This endpoint previously exposed tenant, product, and connection data
 * to ANY unauthenticated caller (a security hole). It is now restricted
 * to the WooCommerce connection (HMAC) so only the merchant's plugin can
 * read it. No secrets are included in the response.
 */
export async function GET(request: Request) {
  const connectionId = request.headers.get("X-Karta-Connection-Id");
  const timestamp = request.headers.get("X-Karta-Timestamp");
  const signature = request.headers.get("X-Karta-Signature");

  const auth = await authenticateWordPressRequest(connectionId, timestamp, signature);

  if (!auth.success) {
    return NextResponse.json({ error: auth.error }, { status: 401 });
  }

  const tenantId = auth.tenantId!;

  const tenants = await prisma.tenant.findMany({
    where: { id: tenantId },
    include: {
      products: {
        where: { status: { not: "archived" } },
        include: { variants: true },
      },
      connections: {
        select: {
          id: true,
          connectionId: true,
          siteUrl: true,
          status: true,
          lastSyncAt: true,
        },
      },
    },
  });

  const productCount = await prisma.product.count({ where: { tenantId } });
  const variantCount = await prisma.productVariant.count();

  return NextResponse.json({
    productCount,
    variantCount,
    tenants: tenants.map((t) => ({
      id: t.id,
      name: t.name,
      slug: t.slug,
      createdAt: t.createdAt,
      connections: t.connections.map((c) => ({
        id: c.id,
        connectionId: c.connectionId,
        siteUrl: c.siteUrl,
        status: c.status,
        lastSyncAt: c.lastSyncAt,
      })),
      products: t.products.map((p) => ({
        id: p.id,
        externalId: p.externalId,
        name: p.name,
        price: p.price,
        stock: p.stock,
        status: p.status,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
        variantCount: p.variants.length,
      })),
    })),
  });
}
