import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";

export async function GET() {
  const tenants = await prisma.tenant.findMany({
    orderBy: { createdAt: "asc" },
    include: {
      products: {
        include: { variants: true },
      },
      connections: true,
    },
  });

  const productCount = await prisma.product.count();
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
