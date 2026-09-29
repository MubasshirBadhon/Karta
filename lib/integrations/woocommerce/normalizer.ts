import { z } from "zod";

/**
 * WooCommerce Product Normalizer
 *
 * Converts WooCommerce product data to Karta's internal format.
 * This is the boundary between WooCommerce's data model and Karta's.
 *
 * WooCommerce Product → Karta Product
 */

// ─── Zod Schemas ──────────────────────────────────────────────

const VariationSchema = z.object({
  externalId: z.string(),
  sku: z.string().nullable().optional(),
  name: z.string(),
  price: z.number(),
  regularPrice: z.number().optional(),
  salePrice: z.number().nullable().optional(),
  stockQuantity: z.number().int().nullable(),
  stockStatus: z.string(),
  manageStock: z.boolean().optional(),
  image: z.string().nullable().optional(),
  attributes: z.record(z.string()).default({}),
});

const ProductSchema = z.object({
  externalId: z.string(),
  sku: z.string().nullable().optional(),
  name: z.string().min(1),
  slug: z.string().optional(),
  description: z.string().nullable().optional(),
  shortDescription: z.string().nullable().optional(),
  price: z.number().nonnegative(),
  regularPrice: z.number().nonnegative().optional(),
  salePrice: z.number().nonnegative().nullable().optional(),
  stockQuantity: z.number().int().nullable().default(null),
  stockStatus: z.string().default("instock"),
  manageStock: z.boolean().optional(),
  image: z.string().nullable().optional(),
  type: z.enum(["simple", "variable"]),
  variations: z.array(VariationSchema).default([]),
});

const SyncRequestSchema = z.object({
  products: z.array(ProductSchema).min(1).max(100),
});

// ─── Types ───────────────────────────────────────────────────

export interface NormalizedVariation {
  externalId: string;
  sku: string | null;
  name: string;
  price: number;
  stock: number | null;
  attributes: Record<string, string>;
}

export interface NormalizedProduct {
  externalId: string;
  sku: string | null;
  name: string;
  slug: string;
  description: string | null;
  price: number;
  compareAtPrice: number | null;
  stock: number | null;
  image: string | null;
  status: string;
  type: "simple" | "variable";
  variations: NormalizedVariation[];
}

export interface SyncResult {
  created: number;
  updated: number;
  failed: number;
  errors: string[];
}

// ─── Normalizer ──────────────────────────────────────────────

/**
 * Normalize a single WooCommerce product to Karta format.
 */
export function normalizeProduct(product: z.infer<typeof ProductSchema>): NormalizedProduct {
  const slug = product.slug || product.name.toLowerCase().replace(/\s+/g, "-");

  // Determine status from stock status
  let status = "active";
  if (product.stockStatus === "outofstock") {
    status = "active"; // Still active, just out of stock
  }

  // For variable products, price comes from variations
  let price = product.price;
  if (product.type === "variable" && product.variations.length > 0) {
    // Use the lowest variation price as the base price
    price = Math.min(...product.variations.map((v) => v.price));
  }

  // Calculate compare-at price (regular price if it's higher than sale price)
  let compareAtPrice: number | null = null;
  if (product.regularPrice && product.regularPrice > price) {
    compareAtPrice = product.regularPrice;
  }

  // Handle stock quantity:
  // - If manageStock is false, stockQuantity may be null (stock not managed)
  // - If manageStock is true, stockQuantity should be a number
  // - For variable products, sum all variation stock
  let stock: number | null = product.stockQuantity;
  if (product.type === "variable") {
    // For variable products, sum variation stock (only non-null values)
    const variationStocks = product.variations.map((v) => v.stockQuantity).filter((s): s is number => s !== null);
    if (variationStocks.length > 0) {
      stock = variationStocks.reduce((sum, s) => sum + s, 0);
    } else {
      stock = null; // No variation stock data
    }
  }

  return {
    externalId: product.externalId,
    sku: product.sku || null,
    name: product.name,
    slug,
    description: product.description || product.shortDescription || null,
    price,
    compareAtPrice,
    stock,
    image: product.image || null,
    status,
    type: product.type,
    variations: product.variations.map((v) => ({
      externalId: v.externalId,
      sku: v.sku || null,
      name: v.name,
      price: v.price,
      stock: v.stockQuantity,
      attributes: v.attributes,
    })),
  };
}

/**
 * Validate and normalize a sync request.
 */
export function validateSyncRequest(body: unknown): {
  success: boolean;
  products?: NormalizedProduct[];
  errors?: string[];
} {
  const result = SyncRequestSchema.safeParse(body);

  if (!result.success) {
    return {
      success: false,
      errors: result.error.errors.map((e) => `${e.path.join(".")}: ${e.message}`),
    };
  }

  const products = result.data.products.map(normalizeProduct);

  return { success: true, products };
}
