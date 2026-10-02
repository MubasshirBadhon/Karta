import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * Website Chat Widget — Focused Tests (second pass)
 *
 * Covers: stock semantics (null/managed/outofstock), product lifecycle
 * (deleted products, disconnected stores), tenant isolation, productUrl/
 * imageUrl persistence, budget max/range, category/color/variant matching,
 * follow-up references, add-to-cart confirmation flow, WooCommerce
 * product/variation IDs, location persistence, structured product
 * response, and Markdown-table sanitization.
 */

// Mock Prisma (covers route + cors + site-access + conversation-service)
vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    wooCommerceConnection: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
    conversation: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn(),
      update: vi.fn(),
    },
    product: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    productVariant: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      deleteMany: vi.fn(),
    },
    customerEvent: {
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({}),
      groupBy: vi.fn().mockResolvedValue([]),
    },
    message: {
      create: vi.fn(),
      findMany: vi.fn(),
    },
  },
}));

// Mock the AI engine (no LLM calls in tests)
vi.mock("@/lib/ai/commerce-engine", () => ({
  processMessage: vi.fn(),
}));

import { prisma } from "@/lib/db/prisma";
import { processMessage } from "@/lib/ai/commerce-engine";
import { POST, OPTIONS } from "@/app/api/chat/route";
import {
  isAllowedWebsiteOrigin,
  fetchAllowedSiteUrls,
} from "@/lib/web/cors";
import {
  resolveSiteTokenContext,
  resolveConversationContext,
} from "@/lib/web/site-access";
import { normalizeProduct } from "@/lib/integrations/woocommerce/normalizer";
import { syncProducts, softDeleteProduct } from "@/lib/integrations/woocommerce/sync";
import {
  extractBudget,
  extractBudgetRange,
  extractQuantity,
  detectCategoryKey,
  detectColor,
  detectSize,
  extractMentionedProductIds,
  stripProductMarkers,
  sanitizeAssistantText,
  pickProducts,
  buildProductCards,
  isProductAvailable,
  availabilityLabel,
  resolveVariant,
  findProductByName,
  wantsToAddToCart,
  isConfirmation,
  type CatalogProduct,
} from "@/lib/commerce/catalog-matcher";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyMock = any;

const mockedPrisma = prisma as AnyMock;
const mockedProcessMessage = processMessage as AnyMock;

// ─── Fixtures ────────────────────────────────────────────────

const SITE_URL = "https://bd-deals.unaux.com";
const SITE_TOKEN = "kwc_demo_token";

const mockConnection = {
  id: "conn-1",
  tenantId: "tenant-1",
  connectionId: SITE_TOKEN,
  siteUrl: SITE_URL,
  siteName: "BD Deals",
  status: "active",
  tenant: { inventoryMode: "unlimited" },
};

// Simulated DB record with metadata (mutated by the mocked update)
let conversationRecord: AnyMock;

const mockCatalog: CatalogProduct[] = [
  {
    id: "prod-watch-1",
    externalId: "101",
    name: "Luma Smart Watch",
    description: "A smarter everyday watch",
    price: 2490,
    compareAtPrice: 2990,
    stock: 12,
    stockStatus: "instock",
    manageStock: true,
    status: "active",
    image: "https://bd-deals.unaux.com/wp-content/uploads/watch.jpg",
    productUrl: `${SITE_URL}/product/luma-smart-watch/`,
    sku: "WATCH-001",
    category: "Wearables",
    variants: [
      {
        id: "var-1",
        externalId: "501",
        name: "Black",
        attributes: { color: "Black" },
        price: 2490,
        stock: 5,
      },
      {
        id: "var-2",
        externalId: "502",
        name: "Silver",
        attributes: { color: "Silver" },
        price: 2590,
        stock: 7,
      },
    ],
  },
  {
    id: "prod-budget-1",
    externalId: "102",
    name: "Budget Keyboard",
    description: "Cheap mechanical keyboard",
    price: 450,
    compareAtPrice: null,
    stock: 30,
    stockStatus: "instock",
    manageStock: true,
    status: "active",
    image: null,
    productUrl: `${SITE_URL}/product/budget-keyboard/`,
    sku: "KEY-001",
    category: "Electronics",
    variants: [],
  },
  {
    id: "prod-unmanaged-1",
    externalId: "103",
    name: "Unmanaged Stock Item",
    description: null,
    price: 1290,
    compareAtPrice: null,
    stock: null, // stock management disabled - always available
    stockStatus: "instock",
    manageStock: false,
    status: "active",
    image: null,
    productUrl: null,
    sku: null,
    category: null,
    variants: [],
  },
  {
    id: "prod-outofstock-1",
    externalId: "104",
    name: "Sold Out Item",
    description: null,
    price: 900,
    compareAtPrice: null,
    stock: null, // quantity unknown...
    stockStatus: "outofstock", // ...but WooCommerce says out of stock (manual, merchant-set)
    manageStock: false,
    status: "active",
    image: null,
    productUrl: `${SITE_URL}/product/sold-out-item/`,
    sku: "SO-001",
    category: "Electronics",
    variants: [],
  },
];

function makePostRequest(body: Record<string, unknown>, origin?: string): Request {
  return new Request("https://karta-ozla.onrender.com/api/chat", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(origin ? { origin } : {}),
    },
    body: JSON.stringify({ visitorId: "kvid_" + "a".repeat(32), ...body }),
  });
}

function makeOptionsRequest(origin?: string): Request {
  return new Request("https://karta-ozla.onrender.com/api/chat", {
    method: "OPTIONS",
    headers: {
      "access-control-request-method": "POST",
      "access-control-request-headers": "content-type",
      ...(origin ? { origin } : {}),
    },
  });
}

function setupHappyPath() {
  mockedPrisma.wooCommerceConnection.findUnique.mockResolvedValue(mockConnection);
  mockedPrisma.wooCommerceConnection.findFirst.mockResolvedValue(mockConnection);
  mockedPrisma.wooCommerceConnection.findMany.mockResolvedValue([mockConnection]);
  mockedPrisma.message.findMany.mockResolvedValue([]);
  mockedPrisma.message.create.mockResolvedValue({});
  mockedPrisma.product.findMany.mockResolvedValue(mockCatalog);
  mockedProcessMessage.mockResolvedValue({
    text: "Here are some products [PRODUCT:prod-watch-1]",
    success: true,
  });
  // Simulated conversation record with metadata round-trip
  conversationRecord = {
    id: "conv-1",
    tenantId: "tenant-1",
    channel: "web",
    status: "active",
    metadata: null,
  };
  mockedPrisma.conversation.findUnique.mockImplementation(() =>
    Promise.resolve(conversationRecord)
  );
  mockedPrisma.conversation.findFirst.mockResolvedValue(conversationRecord);
  mockedPrisma.conversation.update.mockImplementation(({ data }: AnyMock) => {
    conversationRecord = { ...conversationRecord, ...data };
    return Promise.resolve(conversationRecord);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  setupHappyPath();
});

// ─── CORS / preflight ────────────────────────────────────────

describe("CORS / preflight", () => {
  it("answers OPTIONS with 204 + CORS headers for a valid website origin", async () => {
    const res = await OPTIONS(makeOptionsRequest(SITE_URL));
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe(SITE_URL);
    expect(res.headers.get("access-control-allow-methods")).toContain("POST");
    expect(
      res.headers.get("access-control-allow-headers")!.toLowerCase()
    ).toContain("content-type");
    expect(res.headers.get("access-control-allow-credentials")).toBeNull();
  });

  it("blocks OPTIONS for an unknown origin (no Allow-Origin header)", async () => {
    const res = await OPTIONS(makeOptionsRequest("https://evil.example.com"));
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("never returns Access-Control-Allow-Origin: *", async () => {
    const res = await OPTIONS(makeOptionsRequest(SITE_URL));
    expect(res.headers.get("access-control-allow-origin")).not.toBe("*");
    expect(res.headers.get("access-control-allow-origin")).toBe(SITE_URL);
  });

  it("allows POST from the valid website origin and echoes the origin", async () => {
    const res = await POST(
      makePostRequest({ message: "watch ache?", siteToken: SITE_TOKEN }, SITE_URL)
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe(SITE_URL);
  });

  it("rejects POST from an invalid origin with 403 and no Allow-Origin header", async () => {
    const res = await POST(
      makePostRequest({ message: "hi", siteToken: SITE_TOKEN }, "https://evil.example.com")
    );
    expect(res.status).toBe(403);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("normalizes www variants and trailing slashes of the origin", () => {
    expect(
      isAllowedWebsiteOrigin("https://www.bd-deals.unaux.com", [SITE_URL])
    ).toBe(true);
    expect(
      isAllowedWebsiteOrigin("https://bd-deals.unaux.com/", [SITE_URL])
    ).toBe(true);
    expect(isAllowedWebsiteOrigin("https://bd-deals2.unaux.com", [SITE_URL])).toBe(false);
  });
});

// ─── Public site token resolution ────────────────────────────

describe("public site token resolution", () => {
  it("resolves a valid site token to the WooCommerce connection and tenant", async () => {
    const ctx = await resolveSiteTokenContext(SITE_TOKEN);
    expect(ctx).not.toBeNull();
    expect(ctx!.tenantId).toBe("tenant-1");
    expect(ctx!.connectionId).toBe(SITE_TOKEN);
    expect(ctx!.siteUrl).toBe(SITE_URL);
  });

  it("rejects an unknown site token", async () => {
    mockedPrisma.wooCommerceConnection.findUnique.mockResolvedValue(null);
    const ctx = await resolveSiteTokenContext("kwc_invalid");
    expect(ctx).toBeNull();
  });

  it("rejects a site token for a disconnected store", async () => {
    mockedPrisma.wooCommerceConnection.findUnique.mockResolvedValue({
      ...mockConnection,
      status: "disconnected",
    });
    const ctx = await resolveSiteTokenContext(SITE_TOKEN);
    expect(ctx).toBeNull();
  });

  it("resolves tenant from an existing conversationId (continuation)", async () => {
    const ctx = await resolveConversationContext("conv-1");
    expect(ctx).not.toBeNull();
    expect(ctx!.tenantId).toBe("tenant-1");
  });

  it("returns null for a nonexistent conversation", async () => {
    mockedPrisma.conversation.findUnique.mockResolvedValue(null);
    const ctx = await resolveConversationContext("conv-missing");
    expect(ctx).toBeNull();
  });
});

// ─── Product lifecycle: deletion + disconnection ─────────────

describe("product lifecycle", () => {
  it("a deleted (archived) product is not recommended", () => {
    const candidates = pickProducts(
      mockCatalog.map((p) => (p.id === "prod-watch-1" ? { ...p, status: "archived" } : p)),
      "watch ache?"
    );
    expect(candidates.every((p) => p.id !== "prod-watch-1")).toBe(true);
  });

  it("a deleted (archived) product never appears in cards", () => {
    const cards = buildProductCards(
      mockCatalog.map((p) => (p.id === "prod-watch-1" ? { ...p, status: "archived" } : p)),
      ["prod-watch-1"]
    );
    // Falls back to available products — never the archived one
    expect(cards.every((c) => c.id !== "prod-watch-1")).toBe(true);
  });

  it("softDeleteProduct archives instead of hard-deleting", async () => {
    mockedPrisma.product.findFirst.mockResolvedValue({ id: "prod-1", status: "active" });
    mockedPrisma.product.update.mockResolvedValue({});

    const result = await softDeleteProduct("tenant-1", "conn-1", "101");

    expect(result).toBe(true);
    expect(mockedPrisma.product.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "archived" }),
      })
    );
    // The Prisma mock has no delete method configured — soft deletion only
    expect(mockedPrisma.product.delete).toBeUndefined();
  });

  it("a disconnected store's products do not leak via old conversations", async () => {
    // Tenant has NO active connection (disconnected)
    mockedPrisma.wooCommerceConnection.findFirst.mockResolvedValue(null);

    const ctx = await resolveConversationContext("conv-1");
    expect(ctx).toBeNull();
  });

  it("rejects a conversationId belonging to a different tenant (isolation)", async () => {
    conversationRecord = {
      id: "conv-other",
      tenantId: "tenant-other",
      channel: "web",
      status: "active",
      metadata: null,
    };
    mockedPrisma.wooCommerceConnection.findFirst.mockResolvedValue(mockConnection);
    mockedPrisma.message.create.mockResolvedValue({});
    mockedProcessMessage.mockResolvedValue({ text: "ok", success: true });

    const res = await POST(
      makePostRequest(
        { message: "watch ache?", conversationId: "conv-other", siteToken: SITE_TOKEN },
        SITE_URL
      )
    );
    expect(res.status).toBe(401);
  });

  it("tenant isolation: loads only the site token tenant's products", async () => {
    const res = await POST(
      makePostRequest({ message: "watch ache?", siteToken: SITE_TOKEN }, SITE_URL)
    );
    expect(res.status).toBe(200);
    expect(mockedPrisma.product.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ tenantId: "tenant-1", status: "active" }),
      })
    );
  });
});

// ─── Stock semantics ─────────────────────────────────────────

describe("stock semantics", () => {
  it("stock=null with active status means available (not managed)", () => {
    expect(isProductAvailable(mockCatalog[2])).toBe(true);
    expect(availabilityLabel(mockCatalog[2])).toBe("Available");
  });

  it("stock=0 with managed stock means unavailable", () => {
    expect(
      isProductAvailable({ ...mockCatalog[0], stock: 0, manageStock: true }, "managed")
    ).toBe(false);
    expect(availabilityLabel({ ...mockCatalog[0], stock: 0, manageStock: true }, "managed")).toBe("Out of stock");
  });

  it("stock>0 means available with count (managed mode)", () => {
    expect(isProductAvailable({ ...mockCatalog[0], manageStock: true }, "managed")).toBe(true);
    expect(availabilityLabel({ ...mockCatalog[0], manageStock: true }, "managed")).toBe("In stock (12)");
  });

  it("explicit WooCommerce outofstock is unavailable even when quantity is null", () => {
    expect(isProductAvailable(mockCatalog[3], "unlimited")).toBe(false);
    expect(availabilityLabel(mockCatalog[3], "unlimited")).toBe("Out of stock");
  });

  it("null stock is never converted to 0 by the normalizer", () => {
    const normalized = normalizeProduct({
      externalId: "203",
      name: "Unmanaged Product",
      price: 100,
      stockQuantity: null,
      stockStatus: "instock",
      manageStock: false,
      type: "simple",
      variations: [],
    });
    expect(normalized.stock).toBeNull();
  });

  it("out-of-stock products are excluded from deterministic recommendations", () => {
    const candidates = pickProducts(mockCatalog, "show me electronics");
    expect(candidates.every((p) => isProductAvailable(p))).toBe(true);
    expect(candidates.every((p) => p.id !== "prod-outofstock-1")).toBe(true);
  });
});

// ─── productUrl / imageUrl persistence ───────────────────────

describe("productUrl and imageUrl persistence", () => {
  it("normalizer preserves the WooCommerce permalink and gallery images", () => {
    const normalized = normalizeProduct({
      externalId: "201",
      name: "Test Product",
      slug: "test-product",
      description: "Desc",
      price: 100,
      stockQuantity: 5,
      stockStatus: "instock",
      image: "https://bd-deals.unaux.com/wp-content/uploads/primary.jpg",
      images: [
        "https://bd-deals.unaux.com/wp-content/uploads/1.jpg",
        "https://bd-deals.unaux.com/wp-content/uploads/2.jpg",
      ],
      category: "Electronics",
      productUrl: `${SITE_URL}/product/test-product/`,
      type: "simple",
      variations: [],
    });

    expect(normalized.productUrl).toBe(`${SITE_URL}/product/test-product/`);
    expect(normalized.image).toBe("https://bd-deals.unaux.com/wp-content/uploads/primary.jpg");
    expect(normalized.images).toHaveLength(2);
    expect(normalized.category).toBe("Electronics");
    expect(normalized.stockStatus).toBe("instock");
  });

  it("normalizer tolerates products without permalink/images (not invented)", () => {
    const normalized = normalizeProduct({
      externalId: "202",
      name: "No Media Product",
      price: 50,
      stockQuantity: null,
      stockStatus: "instock",
      type: "simple",
      variations: [],
    });
    expect(normalized.productUrl).toBeUndefined();
    expect(normalized.image).toBeNull();
    expect(normalized.images).toBeUndefined();
    expect(normalized.category).toBeUndefined();
  });

  it("sync persists productUrl/images/category/stockStatus on create", async () => {
    mockedPrisma.product.findUnique.mockResolvedValue(null);
    // No legacy row — the product is genuinely new
    mockedPrisma.product.findFirst.mockResolvedValue(null);
    mockedPrisma.product.create.mockResolvedValue({ id: "prod-new" });

    await syncProducts("tenant-1", "conn-1", [
      normalizeProduct({
        externalId: "201",
        name: "Test Product",
        price: 100,
        stockQuantity: 5,
        stockStatus: "instock",
        productUrl: `${SITE_URL}/product/test-product/`,
        images: ["https://bd-deals.unaux.com/wp-content/uploads/1.jpg"],
        category: "Electronics",
        type: "simple",
        variations: [],
      }),
    ]);

    expect(mockedPrisma.product.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          productUrl: `${SITE_URL}/product/test-product/`,
          images: ["https://bd-deals.unaux.com/wp-content/uploads/1.jpg"],
          category: "Electronics",
          stockStatus: "instock",
        }),
      })
    );
  });

  it("sync does not wipe existing fields when the payload omits them", async () => {
    mockedPrisma.product.findFirst.mockResolvedValue({
      id: "prod-1",
      tenantId: "tenant-1",
      externalId: "201",
      createdAt: new Date(Date.now() - 10000),
    });
    mockedPrisma.product.update.mockResolvedValue({});

    await syncProducts("tenant-1", "conn-1", [
      normalizeProduct({
        externalId: "201",
        name: "Test Product",
        price: 100,
        stockQuantity: 5,
        stockStatus: "instock",
        type: "simple",
        variations: [],
      }),
    ]);

    const updateData = mockedPrisma.product.update.mock.calls[0][0].data;
    expect(updateData.productUrl).toBeUndefined();
    expect(updateData.images).toBeUndefined();
    expect(updateData.category).toBeUndefined();
  });
});

// ─── Deterministic budget / range ────────────────────────────

describe("deterministic budget extraction", () => {
  it("extracts a budget ceiling ('500 takar moddhe ki ache?')", () => {
    expect(extractBudget("500 takar moddhe ki ache?")).toBe(500);
  });

  it("extracts 'under 1000'", () => {
    expect(extractBudget("under 1000")).toBe(1000);
  });

  it("extracts a price range ('500 theke 1000')", () => {
    expect(extractBudgetRange("500 theke 1000")).toEqual({ min: 500, max: 1000 });
  });

  it("extracts a price range ('500-1000')", () => {
    expect(extractBudgetRange("500-1000")).toEqual({ min: 500, max: 1000 });
  });

  it("range queries filter deterministically (no LLM math)", () => {
    const candidates = pickProducts(mockCatalog, "1000 theke 3000 taka te khujchi");
    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates.every((p) => Number(p.price) >= 1000 && Number(p.price) <= 3000)).toBe(true);
  });

  it("max budget queries filter price <= max", () => {
    const candidates = pickProducts(mockCatalog, "500 takar moddhe ki ache?");
    expect(candidates.every((p) => Number(p.price) <= 500)).toBe(true);
  });

  it("returns nothing when no products match the budget", () => {
    const candidates = pickProducts(mockCatalog, "10 takar moddhe ki ache?");
    expect(candidates).toEqual([]);
  });

  it("extracts quantities including Bangla digits", () => {
    expect(extractQuantity("2 ta den")).toBe(2);
    expect(extractQuantity("৩টি lagbe")).toBe(3);
    expect(extractQuantity("no quantity here")).toBe(1);
  });
});

// ─── Category / color / variant matching ─────────────────────

describe("category / color / variant matching", () => {
  it("matches Banglish category names ('ghori' matches watch)", () => {
    expect(detectCategoryKey("Ki ki ghori ache?")).toBe("watch");
  });

  it("detects colors in mixed Bangla/English", () => {
    expect(detectColor("Black ta dekhaw")).toBe("black");
    expect(detectColor("নীল color ache?")).toBe("blue");
    expect(detectColor("just a question")).toBeNull();
  });

  it("detects sizes", () => {
    expect(detectSize("medium ta dao")).toBe("m");
    expect(detectSize("size 42 lagbe")).toBe("42");
    expect(detectSize("XL chai")).toBe("xl");
  });

  it("does not mistake budget amounts for sizes", () => {
    // "10 takar moddhe" is a budget query, not a size reference
    expect(detectSize("10 takar moddhe ki ache?")).toBeNull();
    expect(detectSize("500 theke 1000 taka")).toBeNull();
    // ...but real size mentions still work alongside budgets
    expect(detectSize("size 42 under 1000 taka")).toBe("42");
  });

  it("resolves the exact variation deterministically ('black ta dekhaw')", () => {
    const variant = resolveVariant(mockCatalog[0], { color: "black", size: null });
    expect(variant).not.toBeNull();
    expect(variant!.id).toBe("var-1");
    expect(variant!.externalId).toBe("501");
  });

  it("follow-up product reference resolves the previously discussed product", () => {
    const candidates = pickProducts(mockCatalog, "Black ta dekhaw", ["prod-watch-1"]);
    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates[0].id).toBe("prod-watch-1");
  });

  it("finds a product by name mention", () => {
    const product = findProductByName(mockCatalog, "luma smart watch ta dekhaw");
    expect(product).not.toBeNull();
    expect(product!.id).toBe("prod-watch-1");
  });

  it("detects add-to-cart intent and confirmations", () => {
    expect(wantsToAddToCart("eita chai")).toBe(true);
    expect(wantsToAddToCart("2 ta dao")).toBe(true);
    expect(wantsToAddToCart("add kore dao")).toBe(true);
    expect(wantsToAddToCart("just asking")).toBe(false);
    expect(isConfirmation("হ্যাঁ")).toBe(true);
    expect(isConfirmation("yes")).toBe(true);
    expect(isConfirmation("thik ache")).toBe(true);
    expect(isConfirmation("watch ache?")).toBe(false);
  });
});

// ─── Add-to-cart confirmation flow (API) ─────────────────────

describe("add-to-cart confirmation flow", () => {
  it("requires explicit confirmation — no cartAction before the customer confirms", async () => {
    // The customer has a previously viewed SIMPLE product in context
    conversationRecord.metadata = { selectedProductId: "prod-budget-1" };

    const res = await POST(
      makePostRequest({ message: "eita chai", siteToken: SITE_TOKEN }, SITE_URL)
    );
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.intent).toBe("CONFIRM_ADD_TO_CART");
    expect(data.cartAction).toBeNull(); // NOT added yet
    expect(data.selectedProduct).not.toBeNull();
    expect(data.message).toContain("কার্টে যোগ করব");
    // Pending cart is stored in conversation metadata
    expect(conversationRecord.metadata.pendingCart).not.toBeNull();
  });

  it("variable product without a variant mention asks a clarification, not confirmation", async () => {
    conversationRecord.metadata = { selectedProductId: "prod-watch-1" };

    const res = await POST(
      makePostRequest({ message: "eita chai", siteToken: SITE_TOKEN }, SITE_URL)
    );
    const data = await res.json();

    expect(data.intent).toBe("CLARIFY_VARIANT");
    expect(data.cartAction).toBeNull();
    expect(data.message).toContain("ভ্যারিয়েন্ট");
  });

  it("resolves the exact product clicked on a card (targetProductId)", async () => {
    conversationRecord.metadata = { selectedProductId: "prod-watch-1" };

    const res = await POST(
      makePostRequest(
        { message: "add this to cart", targetProductId: "prod-budget-1", siteToken: SITE_TOKEN },
        SITE_URL
      )
    );
    const data = await res.json();

    expect(data.intent).toBe("CONFIRM_ADD_TO_CART");
    expect(data.selectedProduct.id).toBe("prod-budget-1"); // the clicked card, not the last viewed
    expect(data.message).toContain("Budget Keyboard");
  });

  it("without any product context, an add-to-cart request asks what they want", async () => {
    const res = await POST(
      makePostRequest({ message: "eita chai", siteToken: SITE_TOKEN }, SITE_URL)
    );
    const data = await res.json();

    expect(data.intent).toBe("NO_MATCH");
    expect(data.cartAction).toBeNull();
  });

  it("an explicit card target overrides a stale pending confirmation", async () => {
    // A pending confirmation exists from earlier (the mug)
    conversationRecord.metadata = {
      selectedProductId: "prod-budget-1",
      pendingCart: { productId: "prod-stale-mug", variationId: null, variationExternalId: null, quantity: 1 },
    };

    // The customer clicks Add on the T-shirt card — the explicit target
    // supersedes the stale pending confirmation
    const res = await POST(
      makePostRequest(
        { message: "add this to cart", targetProductId: "prod-budget-1", siteToken: SITE_TOKEN },
        SITE_URL
      )
    );
    const data = await res.json();

    expect(data.intent).toBe("CONFIRM_ADD_TO_CART");
    expect(data.selectedProduct.id).toBe("prod-budget-1");
    // The pending cart is replaced with the explicitly chosen product
    expect(conversationRecord.metadata.pendingCart.productId).toBe("prod-budget-1");
  });

  it("returns the correct WooCommerce product ID after confirmation", async () => {
    // First: the add-to-cart intent stores the pending cart
    conversationRecord.metadata = { selectedProductId: "prod-watch-1" };
    await POST(makePostRequest({ message: "eita chai", siteToken: SITE_TOKEN }, SITE_URL));

    // Then: explicit confirmation
    const res = await POST(
      makePostRequest({ message: "হ্যাঁ", conversationId: "conv-1", siteToken: SITE_TOKEN }, SITE_URL)
    );
    const data = await res.json();

    expect(data.intent).toBe("ADD_TO_CART_CONFIRMED");
    expect(data.cartAction).not.toBeNull();
    expect(data.cartAction.type).toBe("addToCart");
    expect(data.cartAction.productId).toBe("101"); // WooCommerce external ID
  });

  it("returns the correct WooCommerce variation ID after confirmation", async () => {
    conversationRecord.metadata = { selectedProductId: "prod-watch-1" };
    await POST(makePostRequest({ message: "black ta chai", siteToken: SITE_TOKEN }, SITE_URL));
    const res = await POST(
      makePostRequest({ message: "হ্যাঁ", conversationId: "conv-1", siteToken: SITE_TOKEN }, SITE_URL)
    );
    const data = await res.json();

    expect(data.cartAction).not.toBeNull();
    expect(data.cartAction.variationId).toBe("501"); // WooCommerce variation external ID
  });

  it("quantity from '2 ta dao' is used in the cart action", async () => {
    conversationRecord.metadata = { selectedProductId: "prod-watch-1" };
    await POST(makePostRequest({ message: "2 ta dao", siteToken: SITE_TOKEN }, SITE_URL));
    const res = await POST(
      makePostRequest({ message: "হ্যাঁ", conversationId: "conv-1", siteToken: SITE_TOKEN }, SITE_URL)
    );
    const data = await res.json();

    expect(data.cartAction.quantity).toBe(2);
  });

  it("variable product with unresolved variant asks a clarification first", async () => {
    conversationRecord.metadata = { selectedProductId: "prod-watch-1" };
    const res = await POST(
      makePostRequest({ message: "watch ta nibo", siteToken: SITE_TOKEN }, SITE_URL)
    );
    const data = await res.json();

    expect(data.intent).toBe("CLARIFY_VARIANT");
    expect(data.cartAction).toBeNull();
    expect(data.message).toContain("ভ্যারিয়েন্ট");
    expect(data.message).toContain("Black");
  });

  it("adding a deleted product after confirmation is refused", async () => {
    conversationRecord.metadata = {
      pendingCart: { productId: "prod-deleted", variationId: null, variationExternalId: null, quantity: 1 },
    };

    const res = await POST(
      makePostRequest({ message: "হ্যাঁ", conversationId: "conv-1", siteToken: SITE_TOKEN }, SITE_URL)
    );
    const data = await res.json();

    expect(data.intent).toBe("NO_MATCH");
    expect(data.cartAction).toBeNull();
  });
});

// ─── Location persistence ────────────────────────────────────

describe("location persistence", () => {
  it("persists the customer's location after a delivery question", async () => {
    // The previous assistant message asked about delivery
    mockedPrisma.message.findMany.mockResolvedValue([
      { role: "user", content: "delivery cost koto?" },
      { role: "assistant", content: "আপনার ডেলিভারি কোন এলাকা/জেলায় হবে?" },
    ]);

    const res = await POST(
      makePostRequest({ message: "Dhaka", conversationId: "conv-1", siteToken: SITE_TOKEN }, SITE_URL)
    );
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(conversationRecord.metadata.location).toBe("Dhaka");
    expect(data.location).toBe("Dhaka");
  });

  it("location is included in the response and AI supplement context", async () => {
    mockedPrisma.message.findMany.mockResolvedValue([
      { role: "assistant", content: "আপনার ডেলিভারি কোন এলাকায় হবে?" },
    ]);
    conversationRecord.metadata = { location: "Dhaka" };

    // A general question (no product signal) reaches the LLM path;
    // the persisted location must reach the AI supplement unchanged.
    const res = await POST(
      makePostRequest(
        { message: "do you offer home delivery?", conversationId: "conv-1", siteToken: SITE_TOKEN },
        SITE_URL
      )
    );
    expect(res.status).toBe(200);
    const supplement = mockedProcessMessage.mock.calls[0][2].extraSystem;
    expect(supplement).toContain('delivery location is: "Dhaka"');
    // A question is not a new location answer — the location is unchanged
    expect(conversationRecord.metadata.location).toBe("Dhaka");
  });
});

// ─── Structured product response / no Markdown tables ────────

describe("structured product response", () => {
  it("returns the full structured response shape", async () => {
    const res = await POST(
      makePostRequest({ message: "watch ache?", siteToken: SITE_TOKEN }, SITE_URL)
    );
    const data = await res.json();

    expect(data.success).toBe(true);
    expect(data.intent).toBe("PRODUCT_SEARCH");
    expect(typeof data.message).toBe("string");
    expect(Array.isArray(data.products)).toBe(true);
    expect(data.products.length).toBeGreaterThan(0);
    expect(data.products.length).toBeLessThanOrEqual(4); // initial recommendations limited
    expect(data.cartAction).toBeNull();

    const card = data.products[0];
    expect(card).toHaveProperty("id");
    expect(card).toHaveProperty("name");
    expect(card).toHaveProperty("price");
    expect(card).toHaveProperty("compareAtPrice");
    expect(card).toHaveProperty("availability");
    expect(card).toHaveProperty("imageUrl");
    expect(card).toHaveProperty("productUrl");
    expect(card).toHaveProperty("variants");
    expect(card).toHaveProperty("available");
  });

  it("returns the real WooCommerce product URL (never constructed)", async () => {
    const res = await POST(
      makePostRequest({ message: "watch ache?", siteToken: SITE_TOKEN }, SITE_URL)
    );
    const data = await res.json();
    const watchCard = data.products.find((p: AnyMock) => p.id === "prod-watch-1");
    expect(watchCard).toBeDefined();
    expect(watchCard.productUrl).toBe(`${SITE_URL}/product/luma-smart-watch/`);
  });

  it("returns the real product image URL from the database", async () => {
    const res = await POST(
      makePostRequest({ message: "watch ache?", siteToken: SITE_TOKEN }, SITE_URL)
    );
    const data = await res.json();
    const watchCard = data.products.find((p: AnyMock) => p.id === "prod-watch-1");
    expect(watchCard.imageUrl).toBe("https://bd-deals.unaux.com/wp-content/uploads/watch.jpg");
  });

  it("omits the image rather than inventing one when the product has none", () => {
    const cards = buildProductCards(mockCatalog, ["prod-budget-1"]);
    expect(cards[0].imageUrl).toBeNull();
  });

  it("no Markdown product tables — the search text is a short intro", async () => {
    const res = await POST(
      makePostRequest({ message: "watch ache?", siteToken: SITE_TOKEN }, SITE_URL)
    );
    const data = await res.json();
    expect(data.message).not.toContain("|");
    expect(data.message).not.toContain("[PRODUCT:");
    expect(data.message.length).toBeLessThan(120);
    // Product info lives in the structured cards, not the text
    expect(data.products.length).toBeGreaterThan(0);
  });

  it("assistant message is stored WITH markers for follow-up context", async () => {
    await POST(makePostRequest({ message: "watch ache?", siteToken: SITE_TOKEN }, SITE_URL));
    const assistantCall = mockedPrisma.message.create.mock.calls.find(
      (call: AnyMock) => call[0].data.role === "assistant"
    );
    expect(assistantCall).toBeDefined();
    expect(assistantCall[0].data.content).toContain("[PRODUCT:prod-watch-1]");
  });

  it("LLM output is sanitized — tables and markers stripped", () => {
    const dirty =
      "Here you go:\n| পণ্য | দাম |\n|---|---|\n| Watch | ৳100 |\n[PRODUCT:prod-1]\n## Header";
    const clean = sanitizeAssistantText(dirty);
    expect(clean).not.toContain("|");
    expect(clean).not.toContain("[PRODUCT:");
    expect(clean).not.toContain("#");
    expect(clean).toContain("Here you go:");
  });

  it("answers pure greetings deterministically without querying products", async () => {
    const res = await POST(makePostRequest({ message: "hi", siteToken: SITE_TOKEN }, SITE_URL));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.intent).toBe("GREETING");
    expect(data.products).toEqual([]);
    expect(mockedPrisma.product.findMany).not.toHaveBeenCalled();
    expect(mockedProcessMessage).not.toHaveBeenCalled();
  });

  it("conversationId is returned and the conversation is not reset", async () => {
    const res1 = await POST(
      makePostRequest({ message: "watch ache?", siteToken: SITE_TOKEN }, SITE_URL)
    );
    const data1 = await res1.json();
    expect(data1.conversationId).toBe("conv-1");

    const res2 = await POST(
      makePostRequest(
        { message: "black ta dekhaw", conversationId: data1.conversationId, siteToken: SITE_TOKEN },
        SITE_URL
      )
    );
    const data2 = await res2.json();
    expect(data2.conversationId).toBe("conv-1");
    expect(data2.intent).toBe("FOLLOW_UP");
    // "black ta" refers to the previously discussed watch
    expect(data2.products[0].id).toBe("prod-watch-1");
  });
});

// ─── API error responses ─────────────────────────────────────

describe("API error responses", () => {
  it("returns 400 for a missing message", async () => {
    const res = await POST(makePostRequest({ siteToken: SITE_TOKEN }, SITE_URL));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("Message");
  });

  it("returns 401 when neither siteToken nor conversationId is provided", async () => {
    const res = await POST(makePostRequest({ message: "hi" }, SITE_URL));
    expect(res.status).toBe(401);
    const data = await res.json();
    expect(data.error).toContain("Site token");
  });

  it("returns 401 for an invalid site token", async () => {
    mockedPrisma.wooCommerceConnection.findUnique.mockResolvedValue(null);
    const res = await POST(
      makePostRequest({ message: "hi", siteToken: "kwc_invalid" }, SITE_URL)
    );
    expect(res.status).toBe(401);
    const data = await res.json();
    expect(data.error).toContain("Invalid site token");
  });

  it("returns 500 on internal errors (without exposing internals)", async () => {
    mockedPrisma.product.findMany.mockRejectedValue(new Error("db connection lost: secret-stuff"));
    const res = await POST(
      makePostRequest({ message: "watch ache?", siteToken: SITE_TOKEN }, SITE_URL)
    );
    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data.error).toBe("Internal server error");
    expect(JSON.stringify(data)).not.toContain("secret-stuff");
  });

  it("includes CORS headers on error responses", async () => {
    const res = await POST(makePostRequest({ siteToken: SITE_TOKEN }, SITE_URL));
    expect(res.status).toBe(400);
    expect(res.headers.get("access-control-allow-origin")).toBe(SITE_URL);
  });
});

// ─── Marker helpers (direct) ─────────────────────────────────

describe("product marker helpers", () => {
  it("extracts mentioned IDs from AI text", () => {
    const ids = extractMentionedProductIds(
      "Check this out [PRODUCT:prod-1] and also [PRODUCT:prod-2]"
    );
    expect(ids).toEqual(["prod-1", "prod-2"]);
  });

  it("strips markers and collapses extra newlines", () => {
    const text = stripProductMarkers("Line one\n[PRODUCT:prod-1]\n\n\nLine two");
    expect(text).toBe("Line one\n\nLine two");
  });

  it("returns site URLs of active connections only", async () => {
    mockedPrisma.wooCommerceConnection.findMany.mockResolvedValue([
      { siteUrl: SITE_URL },
      { siteUrl: null },
    ]);
    const urls = await fetchAllowedSiteUrls();
    expect(urls).toEqual([SITE_URL]);
  });
});
