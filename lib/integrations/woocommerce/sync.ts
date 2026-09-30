import { prisma } from "@/lib/db/prisma";
import { Prisma } from "@prisma/client";
import type { NormalizedProduct, SyncResult } from "./normalizer";

/**
 * WooCommerce Product Sync
 *
 * Upserts products from WooCommerce into Karta's database.
 *
 * Product identity is scoped to the WooCommerce connection:
 *   tenantId + wooConnectionId + externalId
 *
 * This means:
 * - Two Woo connections (even under the same tenant) can safely use the
 *   same external product ID without colliding.
 * - When a store is reconnected (new connection), its current products
 *   are new rows scoped to the new connection; old archived rows are NOT
 *   resurrected merely because their external IDs match.
 * - Historical data is preserved: products that disappear from
 *   WooCommerce are archived (status="archived"), never hard-deleted,
 *   because orders/conversations may reference them.
 */

/**
 * Sync a batch of products for a tenant via a specific Woo connection.
 * Creates new products and updates existing ones (connection-scoped).
 */
export async function syncProducts(
  tenantId: string,
  wooConnectionId: string,
  products: NormalizedProduct[]
): Promise<SyncResult> {
  const result: SyncResult = {
    created: 0,
    updated: 0,
    failed: 0,
    errors: [],
  };

  for (const product of products) {
    try {
      const outcome = await upsertProduct(tenantId, wooConnectionId, product);
      if (outcome === "created") {
        result.created++;
      } else {
        result.updated++;
      }
    } catch (error) {
      result.failed++;
      result.errors.push(
        `Failed to sync product ${product.externalId}: ${error instanceof Error ? error.message : "Unknown error"}`
      );
    }
  }

  return result;
}

/**
 * Upsert a single product and its variants, scoped to the Woo connection.
 * Returns "created" or "updated".
 *
 * ADOPTION: if no row exists for (tenantId, wooConnectionId, externalId)
 * but a row with the same externalId exists under a previous/legacy
 * connection, that row is EXPLICITLY matched to the current connection
 * (the current sync saw the product in the live catalog) and claimed:
 * it is updated in place — never duplicated. Archived rows are only
 * resurrected this way (an explicit current-catalog match); rows the
 * current sync did NOT see stay archived and are handled by
 * reconciliation instead.
 */
async function upsertProduct(
  tenantId: string,
  wooConnectionId: string,
  product: NormalizedProduct
): Promise<"created" | "updated"> {
  let existing = await prisma.product.findFirst({
    where: {
      tenantId,
      wooConnectionId,
      externalId: product.externalId,
    },
    include: { variants: true },
  });

  if (!existing) {
    // Adoption: claim the legacy row for this connection (it is
    // explicitly matched by the current sync)
    const legacy = await prisma.product.findFirst({
      where: { tenantId, externalId: product.externalId },
      include: { variants: true },
    });
    if (legacy) {
      existing = legacy;
    }
  }

  if (existing) {
    // Update existing product in place (claiming it for this connection).
    // New fields use undefined when not provided (older plugin versions)
    // so existing synced values are never wiped.
    await prisma.product.update({
      where: { id: existing.id },
      data: {
        wooConnectionId,
        name: product.name,
        slug: product.slug,
        description: product.description,
        price: product.price,
        compareAtPrice: product.compareAtPrice,
        stock: product.stock,
        image: product.image,
        images:
          product.images === undefined
            ? undefined
            : product.images === null
              ? Prisma.JsonNull
              : product.images,
        category: product.category === undefined ? undefined : product.category,
        productUrl: product.productUrl === undefined ? undefined : product.productUrl,
        stockStatus: product.stockStatus === undefined ? undefined : product.stockStatus,
        manageStock: product.manageStock === undefined ? undefined : product.manageStock,
        status: product.status,
      },
    });

    // Sync variants
    if (product.type === "variable" && product.variations.length > 0) {
      await syncVariants(existing.id, product.variations);
    } else if (product.type === "simple") {
      // Remove variants if product type changed from variable to simple
      await prisma.productVariant.deleteMany({
        where: { productId: existing.id },
      });
    }

    return "updated";
  }

  // Create new product (scoped to this Woo connection) — only for
  // external IDs never seen before under any connection.
  const newProduct = await prisma.product.create({
    data: {
      tenantId,
      wooConnectionId,
      externalId: product.externalId,
      sku: product.sku,
      name: product.name,
      slug: product.slug,
      description: product.description,
      price: product.price,
      compareAtPrice: product.compareAtPrice,
      stock: product.stock,
      image: product.image,
      images: product.images ?? undefined,
      category: product.category ?? undefined,
      productUrl: product.productUrl ?? undefined,
      stockStatus: product.stockStatus ?? undefined,
      manageStock: product.manageStock ?? undefined,
      status: product.status,
    },
  });

  // Create variants
  if (product.type === "variable" && product.variations.length > 0) {
    for (const variant of product.variations) {
      await prisma.productVariant.create({
        data: {
          productId: newProduct.id,
          externalId: variant.externalId,
          sku: variant.sku,
          name: variant.name,
          attributes: variant.attributes,
          price: variant.price,
          stock: variant.stock,
        },
      });
    }
  }

  return "created";
}

/**
 * Sync variants for a product.
 * Creates new variants and updates existing ones.
 */
async function syncVariants(
  productId: string,
  variations: NormalizedProduct["variations"]
): Promise<void> {
  for (const variation of variations) {
    const existing = await prisma.productVariant.findFirst({
      where: {
        productId,
        externalId: variation.externalId,
      },
    });

    if (existing) {
      await prisma.productVariant.update({
        where: { id: existing.id },
        data: {
          name: variation.name,
          sku: variation.sku,
          attributes: variation.attributes,
          price: variation.price,
          stock: variation.stock,
        },
      });
    } else {
      await prisma.productVariant.create({
        data: {
          productId,
          externalId: variation.externalId,
          sku: variation.sku,
          name: variation.name,
          attributes: variation.attributes,
          price: variation.price,
          stock: variation.stock,
        },
      });
    }
  }
}

/**
 * Soft-delete a product by marking it as archived (variants stay attached —
 * they are only reachable through their product, which is now archived).
 * Called when a WooCommerce product.deleted webhook arrives.
 *
 * Scoped to the Woo connection (+ legacy rows with no connection) so a
 * webhook from one connection never archives another connection's product.
 */
export async function softDeleteProduct(
  tenantId: string,
  wooConnectionId: string,
  externalId: string
): Promise<boolean> {
  const product = await prisma.product.findFirst({
    where: {
      tenantId,
      externalId,
      status: { not: "archived" },
      OR: [{ wooConnectionId }, { wooConnectionId: null }],
    },
  });

  if (!product) {
    return false;
  }

  await prisma.product.update({
    where: { id: product.id },
    data: { status: "archived" },
  });

  return true;
}

/**
 * Reconcile products after a SUCCESSFUL full sync.
 *
 * Archives any previously-active products for this tenant that were NOT
 * seen in the completed sync:
 * - products synced by this Woo connection whose externalId was not seen
 * - legacy products with no connection scope (synced before
 *   connection-scoped identity existed) whose externalId was not seen
 *
 * Reconciliation happens ONLY after the full sync succeeds — a failed or
 * partial sync never archives anything (the caller gates this).
 * Products are archived, never hard-deleted.
 *
 * Tenant-scoped on the archive side is safe: provisioning enforces at
 * most ONE active Woo connection per tenant, so every active product in
 * the tenant originates from the connection being synchronized.
 */
export async function reconcileProducts(
  tenantId: string,
  wooConnectionId: string,
  seenExternalIds: string[]
): Promise<{ archived: number }> {
  const result = await prisma.product.updateMany({
    where: {
      tenantId,
      status: { not: "archived" },
      externalId: { notIn: seenExternalIds },
      OR: [{ wooConnectionId }, { wooConnectionId: null }],
    },
    data: { status: "archived" },
  });

  return { archived: result.count };
}
