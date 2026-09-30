import { randomBytes } from "crypto";
import { prisma } from "@/lib/db/prisma";
import { Prisma } from "@prisma/client";

/**
 * Woo Customer Cart Store (WhatsApp channel)
 *
 * WhatsApp customers have no browser session, so a server→Woo cart call
 * cannot attach to "their" session — and on hosts that block server-side
 * access to wp-json (e.g. free hosting with JS cookie challenges) the
 * server cannot reach the WooCommerce Store API at all.
 *
 * This store provides the persistent cart identity the WhatsApp flow
 * needs:
 *   tenantId + WhatsApp phone  →  cartToken  →  pending cart items
 *
 * The pending items are materialized into the customer's REAL WooCommerce
 * session cart when they open their personal cart-restore link
 * (?karta-cart=<cartToken>) — the plugin (running on the Woo site, called
 * by the customer's browser) fetches the stored cart from Karta, adds the
 * items with Woo-native cart APIs, and redirects to the real WooCommerce
 * checkout page. WooCommerce remains the source of truth for the cart,
 * checkout, tax, shipping, payment, and order creation — this store only
 * holds what to put in it.
 */

export interface CartStoreItem {
  productId: string; // WooCommerce external product ID
  variationId: string | null; // WooCommerce external variation ID (or null)
  quantity: number;
  name: string;
  price: number;
}

export interface CartStoreEntry {
  cartToken: string;
  tenantId: string;
  phone: string;
  items: CartStoreItem[];
  itemCount: number;
  total: number;
}

function generateCartToken(): string {
  return `kct_${randomBytes(16).toString("hex")}`;
}

function totalsOf(items: CartStoreItem[]): { itemCount: number; total: number } {
  return {
    itemCount: items.reduce((sum, i) => sum + i.quantity, 0),
    total: items.reduce((sum, i) => sum + i.price * i.quantity, 0),
  };
}

/**
 * Get (or create) the persistent cart for a WhatsApp customer.
 * Same phone → same cartToken → same cart.
 */
export async function createOrGetCart(
  tenantId: string,
  phone: string
): Promise<CartStoreEntry> {
  const existing = await prisma.wooCustomerCart.findUnique({
    where: { tenantId_phone: { tenantId, phone } },
  });

  if (existing) {
    const items = (existing.items as unknown as CartStoreItem[]) || [];
    return { cartToken: existing.cartToken, tenantId, phone, items, ...totalsOf(items) };
  }

  const created = await prisma.wooCustomerCart.create({
    data: {
      tenantId,
      phone,
      cartToken: generateCartToken(),
      items: [],
    },
  });

  return { cartToken: created.cartToken, tenantId, phone, items: [], itemCount: 0, total: 0 };
}

/**
 * Add an item to the customer's persistent cart.
 * The same product+variation increments the quantity.
 */
export async function addItemToCart(
  tenantId: string,
  phone: string,
  item: CartStoreItem
): Promise<CartStoreEntry> {
  const cart = await createOrGetCart(tenantId, phone);

  const existingItem = cart.items.find(
    (i) => i.productId === item.productId && (i.variationId ?? null) === (item.variationId ?? null)
  );

  const items: CartStoreItem[] = existingItem
    ? cart.items.map((i) =>
        i === existingItem ? { ...i, quantity: i.quantity + item.quantity } : i
      )
    : [...cart.items, item];

  await prisma.wooCustomerCart.update({
    where: { cartToken: cart.cartToken },
    data: { items: items as unknown as Prisma.InputJsonValue },
  });

  return { ...cart, items, ...totalsOf(items) };
}

/**
 * Get a cart by its token (used by the plugin's cart-restore handler).
 */
export async function getCartByToken(cartToken: string): Promise<CartStoreEntry | null> {
  if (!cartToken) return null;

  const cart = await prisma.wooCustomerCart.findUnique({
    where: { cartToken },
  });

  if (!cart) return null;

  const items = (cart.items as unknown as CartStoreItem[]) || [];
  return {
    cartToken: cart.cartToken,
    tenantId: cart.tenantId,
    phone: cart.phone,
    items,
    ...totalsOf(items),
  };
}

function money(value: number): string {
  return `\u09F3${Number(value || 0).toLocaleString("en-IN")}`;
}

/**
 * Customer-safe cart summary for the WhatsApp reply.
 */
export function formatCartSummary(entry: CartStoreEntry): string {
  const lines: string[] = [];
  for (const item of entry.items) {
    lines.push(`• ${item.name} × ${item.quantity} — ${money(item.price * item.quantity)}`);
  }
  lines.push("");
  lines.push(`মোট: ${money(entry.total)} (${entry.itemCount} টি আইটেম)`);
  return lines.join("\n");
}
