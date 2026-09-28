import { prisma } from "@/lib/db/prisma";
import { validateTenantId } from "@/lib/security";

/**
 * Commerce Service
 *
 * The ONLY way for AI (or any external layer) to interact with product,
 * variant, stock, cart, and order data. The AI must NEVER directly
 * query the database — it always goes through these service methods.
 *
 * Architecture:
 *   AI → Commerce Tool → Commerce Service → Prisma → PostgreSQL
 */

// ─── Types ───────────────────────────────────────────────────

export interface ProductSearchResult {
  id: string;
  name: string;
  slug: string;
  price: number;
  compareAtPrice: number | null;
  stock: number;
  image: string | null;
  status: string;
}

export interface ProductDetails {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  price: number;
  compareAtPrice: number | null;
  stock: number;
  image: string | null;
  status: string;
  variants: VariantInfo[];
}

export interface VariantInfo {
  id: string;
  name: string;
  attributes: Record<string, string>;
  price: number;
  stock: number;
  sku: string | null;
}

export interface StockInfo {
  productId: string;
  variantId?: string;
  stock: number;
  available: boolean;
}

export interface OrderInfo {
  id: string;
  status: string;
  subtotal: number;
  shipping: number;
  total: number;
  currency: string;
  items: OrderItemInfo[];
}

export interface OrderItemInfo {
  id: string;
  quantity: number;
  unitPrice: number;
  productName: string | null;
  variantName: string | null;
}

export interface CartItem {
  productId: string;
  variantId?: string;
  quantity: number;
}

// ─── Product Operations ──────────────────────────────────────

/**
 * Search products by name, slug, or description within a tenant.
 */
export async function searchProducts(
  tenantId: string,
  query: string,
  options?: { limit?: number; maxPrice?: number; minPrice?: number }
): Promise<ProductSearchResult[]> {
  validateTenantId(tenantId);

  const products = await prisma.product.findMany({
    where: {
      tenantId,
      status: "active",
      AND: [
        query
          ? {
              OR: [
                { name: { contains: query, mode: "insensitive" } },
                { slug: { contains: query, mode: "insensitive" } },
                { description: { contains: query, mode: "insensitive" } },
              ],
            }
          : {},
        options?.maxPrice !== undefined
          ? { price: { lte: options.maxPrice } }
          : {},
        options?.minPrice !== undefined
          ? { price: { gte: options.minPrice } }
          : {},
      ],
    },
    take: options?.limit ?? 20,
    select: {
      id: true,
      name: true,
      slug: true,
      price: true,
      compareAtPrice: true,
      stock: true,
      image: true,
      status: true,
    },
  });

  return products.map((p) => ({
    ...p,
    price: Number(p.price),
    compareAtPrice: p.compareAtPrice ? Number(p.compareAtPrice) : null,
  }));
}

/**
 * Get full product details including variants.
 */
export async function getProduct(
  tenantId: string,
  productIdOrSlug: string
): Promise<ProductDetails | null> {
  validateTenantId(tenantId);

  const product = await prisma.product.findFirst({
    where: {
      tenantId,
      OR: [{ id: productIdOrSlug }, { slug: productIdOrSlug }],
    },
    include: {
      variants: true,
    },
  });

  if (!product) return null;

  return {
    id: product.id,
    name: product.name,
    slug: product.slug,
    description: product.description,
    price: Number(product.price),
    compareAtPrice: product.compareAtPrice ? Number(product.compareAtPrice) : null,
    stock: product.stock,
    image: product.image,
    status: product.status,
    variants: product.variants.map((v) => ({
      id: v.id,
      name: v.name,
      attributes: v.attributes as Record<string, string>,
      price: Number(v.price),
      stock: v.stock,
      sku: v.sku,
    })),
  };
}

/**
 * Get a specific variant by ID.
 */
export async function getVariant(
  tenantId: string,
  variantId: string
): Promise<VariantInfo | null> {
  validateTenantId(tenantId);

  const variant = await prisma.productVariant.findFirst({
    where: {
      id: variantId,
      product: { tenantId },
    },
  });

  if (!variant) return null;

  return {
    id: variant.id,
    name: variant.name,
    attributes: variant.attributes as Record<string, string>,
    price: Number(variant.price),
    stock: variant.stock,
    sku: variant.sku,
  };
}

// ─── Stock Operations ────────────────────────────────────────

/**
 * Check stock for a product or specific variant.
 */
export async function checkStock(
  tenantId: string,
  productId: string,
  variantId?: string
): Promise<StockInfo> {
  validateTenantId(tenantId);

  if (variantId) {
    const variant = await prisma.productVariant.findFirst({
      where: {
        id: variantId,
        product: { tenantId },
      },
    });

    return {
      productId,
      variantId,
      stock: variant?.stock ?? 0,
      available: (variant?.stock ?? 0) > 0,
    };
  }

  const product = await prisma.product.findFirst({
    where: {
      id: productId,
      tenantId,
    },
    include: {
      variants: true,
    },
  });

  if (!product) {
    return { productId, stock: 0, available: false };
  }

  // If product has variants, sum all variant stock
  if (product.variants.length > 0) {
    const totalStock = product.variants.reduce((sum, v) => sum + v.stock, 0);
    return {
      productId,
      stock: totalStock,
      available: totalStock > 0,
    };
  }

  return {
    productId,
    stock: product.stock,
    available: product.stock > 0,
  };
}

// ─── Cart Operations ─────────────────────────────────────────

/**
 * Create a cart (represented as a pending order) for a customer.
 */
export async function createCart(
  tenantId: string,
  customerId: string | null,
  items: CartItem[]
): Promise<string> {
  validateTenantId(tenantId);

  // Validate all items belong to the tenant and get pricing
  const validatedItems = await Promise.all(
    items.map(async (item) => {
      const product = await prisma.product.findFirst({
        where: {
          id: item.productId,
          tenantId,
        },
      });

      if (!product) {
        throw new Error(`Product ${item.productId} not found`);
      }

      let unitPrice = Number(product.price);

      if (item.variantId) {
        const variant = await prisma.productVariant.findFirst({
          where: {
            id: item.variantId,
            productId: item.productId,
          },
        });
        if (!variant) {
          throw new Error(`Variant ${item.variantId} not found`);
        }
        unitPrice = Number(variant.price);
      }

      return {
        productId: item.productId,
        variantId: item.variantId,
        quantity: item.quantity,
        unitPrice,
      };
    })
  );

  const subtotal = validatedItems.reduce(
    (sum, item) => sum + item.unitPrice * item.quantity,
    0
  );

  const cart = await prisma.order.create({
    data: {
      tenantId,
      customerId,
      status: "pending",
      subtotal,
      shipping: 0,
      total: subtotal,
      currency: "BDT",
      items: {
        create: validatedItems.map((item) => ({
          productId: item.productId,
          variantId: item.variantId,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
        })),
      },
    },
  });

  return cart.id;
}

/**
 * Update cart items (add, remove, or change quantities).
 */
export async function updateCart(
  tenantId: string,
  cartId: string,
  items: CartItem[]
): Promise<{ cartId: string; total: number }> {
  validateTenantId(tenantId);

  const cart = await prisma.order.findFirst({
    where: { id: cartId, tenantId },
    include: { items: true },
  });

  if (!cart) {
    throw new Error(`Cart ${cartId} not found`);
  }

  if (cart.status !== "pending") {
    throw new Error("Cannot update a non-pending cart");
  }

  // Delete existing items
  await prisma.orderItem.deleteMany({
    where: { orderId: cartId },
  });

  // Create new items
  const validatedItems = await Promise.all(
    items.map(async (item) => {
      const product = await prisma.product.findFirst({
        where: { id: item.productId, tenantId },
      });
      if (!product) throw new Error(`Product ${item.productId} not found`);

      let unitPrice = Number(product.price);
      if (item.variantId) {
        const variant = await prisma.productVariant.findFirst({
          where: { id: item.variantId, productId: item.productId },
        });
        if (!variant) throw new Error(`Variant ${item.variantId} not found`);
        unitPrice = Number(variant.price);
      }

      return {
        productId: item.productId,
        variantId: item.variantId,
        quantity: item.quantity,
        unitPrice,
      };
    })
  );

  const subtotal = validatedItems.reduce(
    (sum, item) => sum + item.unitPrice * item.quantity,
    0
  );

  await prisma.order.update({
    where: { id: cartId },
    data: {
      subtotal,
      total: subtotal,
      items: {
        create: validatedItems.map((item) => ({
          productId: item.productId,
          variantId: item.variantId,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
        })),
      },
    },
  });

  return { cartId, total: subtotal };
}

// ─── Order Operations ────────────────────────────────────────

/**
 * Convert a pending cart to a confirmed order.
 */
export async function createOrder(
  tenantId: string,
  cartId: string
): Promise<OrderInfo> {
  validateTenantId(tenantId);

  const cart = await prisma.order.findFirst({
    where: { id: cartId, tenantId },
    include: { items: { include: { product: true, variant: true } } },
  });

  if (!cart) throw new Error(`Cart ${cartId} not found`);
  if (cart.status !== "pending") throw new Error("Cart is not in pending state");

  const order = await prisma.order.update({
    where: { id: cartId },
    data: { status: "confirmed" },
    include: { items: { include: { product: true, variant: true } } },
  });

  return mapOrderToInfo(order);
}

/**
 * Get order details by ID.
 */
export async function getOrder(
  tenantId: string,
  orderId: string
): Promise<OrderInfo | null> {
  validateTenantId(tenantId);

  const order = await prisma.order.findFirst({
    where: { id: orderId, tenantId },
    include: { items: { include: { product: true, variant: true } } },
  });

  if (!order) return null;

  return mapOrderToInfo(order);
}

// ─── Helpers ─────────────────────────────────────────────────

function mapOrderToInfo(order: {
  id: string;
  status: string;
  subtotal: { toString(): string } | number;
  shipping: { toString(): string } | number;
  total: { toString(): string } | number;
  currency: string;
  items: Array<{
    id: string;
    quantity: number;
    unitPrice: { toString(): string } | number;
    product: { name: string } | null;
    variant: { name: string } | null;
  }>;
}): OrderInfo {
  return {
    id: order.id,
    status: order.status,
    subtotal: Number(order.subtotal),
    shipping: Number(order.shipping),
    total: Number(order.total),
    currency: order.currency,
    items: order.items.map((item) => ({
      id: item.id,
      quantity: item.quantity,
      unitPrice: Number(item.unitPrice),
      productName: item.product?.name ?? null,
      variantName: item.variant?.name ?? null,
    })),
  };
}
