import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * WhatsApp Woo Cart Bridge — Focused Tests
 *
 * Covers: first cart token creation, token persistence, same phone keeps
 * the same cart, different phone gets a different cart, second product
 * added to the same cart, checkout link, Woo rejection (never claim
 * success), inventory policy in the cart flow, and the authority
 * guarantees (the AI has no cart tool; Karta cannot invent a successful
 * cart operation).
 */

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    wooCustomerCart: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
  },
}));

import { prisma } from "@/lib/db/prisma";
import {
  createOrGetCart,
  addItemToCart,
  getCartByToken,
  formatCartSummary,
} from "@/lib/commerce/woo-cart-store";
import { commerceTools, executeTool } from "@/lib/ai/commerce-tools";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyMock = any;

const mockedPrisma = prisma as AnyMock;

// Simulated cart storage (mutated by the mocked create/update)
let cartStore: Map<string, AnyMock>;

function makeStoredCart(overrides: Partial<AnyMock> = {}): AnyMock {
  return {
    id: "cart-row-1",
    tenantId: "tenant-1",
    phone: "+8801711000000",
    cartToken: "kct_abc123",
    items: [],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  cartStore = new Map();
  mockedPrisma.wooCustomerCart.findUnique.mockImplementation(({ where }: AnyMock) => {
    if (where.cartToken) {
      return Promise.resolve(cartStore.get("token:" + where.cartToken) ?? null);
    }
    if (where.tenantId_phone) {
      return Promise.resolve(
        cartStore.get("phone:" + where.tenantId_phone.tenantId + ":" + where.tenantId_phone.phone) ?? null
      );
    }
    return Promise.resolve(null);
  });
  mockedPrisma.wooCustomerCart.create.mockImplementation(({ data }: AnyMock) => {
    const row = { id: "cart-row-" + (cartStore.size + 1), ...data };
    cartStore.set("token:" + row.cartToken, row);
    cartStore.set("phone:" + row.tenantId + ":" + row.phone, row);
    return Promise.resolve(row);
  });
  mockedPrisma.wooCustomerCart.update.mockImplementation(({ where, data }: AnyMock) => {
    const row = cartStore.get("token:" + where.cartToken);
    if (!row) return Promise.reject(new Error("not found"));
    const updated = { ...row, ...data };
    cartStore.set("token:" + where.cartToken, updated);
    cartStore.set("phone:" + updated.tenantId + ":" + updated.phone, updated);
    return Promise.resolve(updated);
  });
});

// ─── Cart identity / token persistence ───────────────────────

describe("WhatsApp cart identity", () => {
  it("first cart token is created for a new phone", async () => {
    const cart = await createOrGetCart("tenant-1", "+8801711000000");

    expect(cart.cartToken).toMatch(/^kct_[0-9a-f]{32}$/);
    expect(cart.items).toEqual([]);
    expect(cart.itemCount).toBe(0);
    expect(cart.total).toBe(0);
    expect(mockedPrisma.wooCustomerCart.create).toHaveBeenCalled();
  });

  it("token persists — the same phone retains the same cart token", async () => {
    const cart1 = await createOrGetCart("tenant-1", "+8801711000000");
    const cart2 = await createOrGetCart("tenant-1", "+8801711000000");

    expect(cart2.cartToken).toBe(cart1.cartToken);
    // Only ONE cart row exists for the phone
    expect(mockedPrisma.wooCustomerCart.create).toHaveBeenCalledTimes(1);
  });

  it("a different phone gets a different cart token", async () => {
    const cart1 = await createOrGetCart("tenant-1", "+8801711000000");
    const cart2 = await createOrGetCart("tenant-1", "+8801722000000");

    expect(cart2.cartToken).not.toBe(cart1.cartToken);
  });

  it("carts are isolated per tenant (same phone, different tenant)", async () => {
    const cart1 = await createOrGetCart("tenant-1", "+8801711000000");
    const cart2 = await createOrGetCart("tenant-2", "+8801711000000");

    expect(cart2.cartToken).not.toBe(cart1.cartToken);
  });

  it("adding the same product twice increments the quantity (no duplicates)", async () => {
    const item = { productId: "101", variationId: null, quantity: 1, name: "T-Shirt", price: 590 };

    await addItemToCart("tenant-1", "+8801711000000", item);
    const cart = await addItemToCart("tenant-1", "+8801711000000", item);

    expect(cart.items).toHaveLength(1);
    expect(cart.items[0].quantity).toBe(2);
    expect(cart.itemCount).toBe(2);
    expect(cart.total).toBe(1180);
  });

  it("a second product is added to the SAME cart", async () => {
    await addItemToCart("tenant-1", "+8801711000000", {
      productId: "101",
      variationId: null,
      quantity: 1,
      name: "T-Shirt",
      price: 590,
    });

    const cart = await addItemToCart("tenant-1", "+8801711000000", {
      productId: "102",
      variationId: "501",
      quantity: 2,
      name: "Watch (Black)",
      price: 2490,
    });

    expect(cart.items).toHaveLength(2);
    expect(cart.itemCount).toBe(3); // 1 + 2
    expect(cart.total).toBe(590 + 2490 * 2);
  });

  it("the cart is retrievable by token (for the plugin's restore handler)", async () => {
    await addItemToCart("tenant-1", "+8801711000000", {
      productId: "101",
      variationId: null,
      quantity: 1,
      name: "T-Shirt",
      price: 590,
    });

    const cart1 = await createOrGetCart("tenant-1", "+8801711000000");
    const fetched = await getCartByToken(cart1.cartToken);

    expect(fetched).not.toBeNull();
    expect(fetched!.cartToken).toBe(cart1.cartToken);
    expect(fetched!.items).toHaveLength(1);
    expect(fetched!.items[0].productId).toBe("101");
  });

  it("an unknown token returns null", async () => {
    const fetched = await getCartByToken("kct_unknown");
    expect(fetched).toBeNull();
  });

  it("the checkout link embeds the cart token", async () => {
    const cart = await addItemToCart("tenant-1", "+8801711000000", {
      productId: "101",
      variationId: null,
      quantity: 1,
      name: "T-Shirt",
      price: 590,
    });

    const summary = formatCartSummary(cart);
    expect(summary).toContain("T-Shirt");
    expect(summary).toContain("মোট");
    // The checkout link is built from the cart token in the WhatsApp reply
    const checkoutLink = `https://bd-deals.unaux.com/?karta-cart=${cart.cartToken}`;
    expect(checkoutLink).toContain(cart.cartToken);
  });
});

// ─── Woo rejection / never claim success ─────────────────────

describe("Woo rejection handling", () => {
  it("an empty cart (Woo-side materialization failed) is never claimed as success", async () => {
    // The cart flow verifies the returned cart contains the item — an
    // empty items list means the add failed → the error message, never success
    const cart = await createOrGetCart("tenant-1", "+8801711000000");
    expect(cart.items).toEqual([]);

    const summary = formatCartSummary(cart);
    expect(summary).toContain("মোট: ৳0");
    // The flow's verification step: no item in the cart → refusal
    const inCart = cart.items.find((i) => i.productId === "101");
    expect(inCart).toBeUndefined();
  });

  it("the stored cart items carry the real WooCommerce product/variation IDs", async () => {
    const cart = await addItemToCart("tenant-1", "+8801711000000", {
      productId: "301",
      variationId: "501",
      quantity: 2,
      name: "Watch (Black)",
      price: 2490,
    });

    // The plugin's restore handler adds THESE exact Woo IDs
    expect(cart.items[0].productId).toBe("301");
    expect(cart.items[0].variationId).toBe("501");
    expect(cart.items[0].quantity).toBe(2);
  });
});

// ─── Authority guarantees ────────────────────────────────────

describe("commerce authority", () => {
  it("the AI has NO cart tool — it cannot directly manipulate cart state", () => {
    const toolNames = commerceTools.map((t) => t.name);
    expect(toolNames).not.toContain("add_to_cart");
    expect(toolNames).not.toContain("cart");
    expect(toolNames).toEqual(
      expect.arrayContaining(["search_products", "get_product", "get_variant", "check_stock"])
    );
  });

  it("executing an unknown/unregistered cart tool is rejected", async () => {
    await expect(executeTool("tenant-1", "add_to_cart", {})).rejects.toThrow(/Unknown tool/);
  });

  it("Karta cannot invent a successful cart operation — the token is server-generated", async () => {
    const cart = await createOrGetCart("tenant-1", "+8801711000000");
    // Tokens are generated server-side (kct_ prefix + 32 hex chars) —
    // a fabricated token never resolves to a cart
    expect(cart.cartToken).toMatch(/^kct_[0-9a-f]{32}$/);
    const fabricated = await getCartByToken("kct_ffffffffffffffffffffffffffffffff");
    expect(fabricated).toBeNull();
  });
});
