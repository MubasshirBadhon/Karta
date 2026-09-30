import { prisma } from "@/lib/db/prisma";
import { Prisma } from "@prisma/client";
import type { NormalizedProduct, SyncResult } from "./normalizer";

/**
 * WooCommerce Product Sync
 *
 * Upserts products from WooCommerce into Karta's database.
 * Uses tenantId + externalId as the logical identity for idempotency.
 */

/**
 * Sync a batch of products for a tenant.
 * Creates new products and updates existing ones.
 */
export async function syncProducts(
  tenantId: string,
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
      await upsertProduct(tenantId, product);
      // Determine if it was created or updated
      const existing = await prisma.product.findUnique({
        where: {
          tenantId_externalId: {
            tenantId,
            externalId: product.externalId,
          },
        },
      });
      if (existing && existing.createdAt < new Date(Date.now() - 1000)) {
        result.updated++;
      } else {
        result.created++;
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
 * Upsert a single product and its variants.
 */
async function upsertProduct(tenantId: string, product: NormalizedProduct): Promise<void> {
  const existing = await prisma.product.findUnique({
    where: {
      tenantId_externalId: {
        tenantId,
        externalId: product.externalId,
      },
    },
    include: { variants: true },
  });

  if (existing) {
    // Update existing product.
    // New fields use undefined when not provided (older plugin versions)
    // so existing synced values are never wiped.
    await prisma.product.update({
      where: { id: existing.id },
      data: {
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
  } else {
    // Create new product
    const newProduct = await prisma.product.create({
      data: {
        tenantId,
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
  }
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
 * Soft-delete a product by marking it as archived.
 * Called when a WooCommerce product is deleted.
 */
export async function softDeleteProduct(
  tenantId: string,
  externalId: string
): Promise<boolean> {
  const product = await prisma.product.findUnique({
    where: {
      tenantId_externalId: {
        tenantId,
        externalId,
      },
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
 * Reconcile products after a full sync.
 * Archives any products in the database that are NOT in the incoming sync batch.
 * This handles products deleted from WooCommerce.
 */
export async function reconcileProducts(
  tenantId: string,
  syncedExternalIds: string[]
): Promise<{ archived: number }> {
  const result = await prisma.product.updateMany({
    where: {
      tenantId,
      externalId: { notIn: syncedExternalIds },
      status: { not: "archived" },
    },
    data: { status: "archived" },
  });

  return { archived: result.count };
}
