import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * Website Chat Widget — Focused Tests
 *
 * Covers: CORS/preflight, origin validation, public site token resolution,
 * tenant isolation, productUrl/imageUrl persistence, WooCommerce permalink
 * synchronization, null stock handling, structured product response,
 * conversationId follow-ups, and API error responses.
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
      create: vi.fn(),
    },
    product: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    productVariant: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      deleteMany: vi.fn(),
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
import { syncProducts } from "@/lib/integrations/woocommerce/sync";
import {
  extractBudget,
  extractQuantity,
  detectCategoryKey,
  detectColor,
  extractProductIdsFromHistory,
  extractMentionedProductIds,
  stripProductMarkers,
  pickProducts,
  buildProductCards,
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
};

const mockCatalog: CatalogProduct[] = [
  {
    id: "prod-watch-1",
    externalId: "101",
    name: "Luma Smart Watch",
    description: "A smarter everyday watch",
    price: 2490,
    compareAtPrice: 2990,
    stock: 12,
    status: "active",
    image: "https://bd-deals.unaux.com/wp-content/uploads/watch.jpg",
    productUrl: `${SITE_URL}/product/luma-smart-watch/`,
    sku: "WATCH-001",
    category: "Wearables",
    variants: [
      {
        id: "var-1",
        name: "Black",
        attributes: { color: "Black" },
        price: 2490,
        stock: 5,
      },
      {
        id: "var-2",
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
    stock: null, // stock management disabled
    status: "active",
    image: null,
    productUrl: null,
    sku: null,
    category: null,
    variants: [],
  },
];

function makePostRequest(body: unknown, origin?: string): Request {
  return new Request("https://karta-ozla.onrender.com/api/chat", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(origin ? { origin } : {}),
    },
    body: JSON.stringify(body),
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
  mockedPrisma.wooCommerceConnection.findMany.mockResolvedValue([mockConnection]);
  mockedPrisma.conversation.findFirst.mockResolvedValue({
    id: "conv-1",
    tenantId: "tenant-1",
    channel: "web",
    status: "active",
  });
  mockedPrisma.conversation.findUnique.mockResolvedValue({
    id: "conv-1",
    tenantId: "tenant-1",
    channel: "web",
    status: "active",
  });
  mockedPrisma.message.findMany.mockResolvedValue([]);
  mockedPrisma.message.create.mockResolvedValue({});
  mockedPrisma.product.findMany.mockResolvedValue(mockCatalog);
  mockedProcessMessage.mockResolvedValue({
    text: "Here are some products [PRODUCT:prod-watch-1]",
    success: true,
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
    // No credentials are used — the credentials header must NOT be sent
    expect(res.headers.get("access-control-allow-credentials")).toBeNull();
  });

  it("blocks OPTIONS for an unknown origin (no Allow-Origin header)", async () => {
    const res = await OPTIONS(makeOptionsRequest("https://evil.example.com"));
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("never returns Access-Control-Allow-Origin: *", async () => {
    const res = await OPTIONS(makeOptionsRequest(SITE_URL));
    const acao = res.headers.get("access-control-allow-origin");
    expect(acao).not.toBe("*");
    expect(acao).toBe(SITE_URL);
  });

  it("allows POST from the valid website origin and echoes the origin", async () => {
    const res = await POST(
      makePostRequest({ message: "hi", siteToken: SITE_TOKEN }, SITE_URL)
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
    const data = await res.json();
    expect(data.error).toContain("Origin");
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
    expect(mockedPrisma.wooCommerceConnection.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { connectionId: SITE_TOKEN } })
    );
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
    mockedPrisma.conversation.findUnique.mockResolvedValue({
      id: "conv-1",
      tenantId: "tenant-1",
      channel: "web",
    });
    mockedPrisma.wooCommerceConnection.findFirst.mockResolvedValue(mockConnection);

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

// ─── Tenant isolation ────────────────────────────────────────

describe("tenant isolation", () => {
  it("loads only the site token tenant's products (no first-tenant fallback)", async () => {
    const res = await POST(makePostRequest({ message: "watch ache?", siteToken: SITE_TOKEN }, SITE_URL));
    expect(res.status).toBe(200);
    expect(mockedPrisma.product.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ tenantId: "tenant-1", status: "active" }),
      })
    );
  });

  it("rejects a conversationId belonging to a different tenant", async () => {
    mockedPrisma.conversation.findUnique.mockResolvedValue({
      id: "conv-other",
      tenantId: "tenant-other",
      channel: "web",
    });
    mockedPrisma.wooCommerceConnection.findFirst.mockResolvedValue(mockConnection);
    mockedPrisma.message.create.mockResolvedValue({});
    mockedPrisma.product.findMany.mockResolvedValue(mockCatalog);
    mockedProcessMessage.mockResolvedValue({ text: "ok", success: true });

    const res = await POST(
      makePostRequest(
        { message: "hi", conversationId: "conv-other", siteToken: SITE_TOKEN },
        SITE_URL
      )
    );
    expect(res.status).toBe(401);
    const data = await res.json();
    expect(data.error).toContain("conversation");
  });
});

// ─── productUrl / imageUrl persistence (normalizer + sync) ──

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
  });

  it("normalizer tolerates products without permalink/images (null, not invented)", () => {
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

  it("sync persists productUrl/images/category on create", async () => {
    mockedPrisma.product.findUnique.mockResolvedValue(null);
    mockedPrisma.product.create.mockResolvedValue({ id: "prod-new" });

    await syncProducts("tenant-1", [
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
        }),
      })
    );
  });

  it("sync does not wipe existing productUrl/images when the payload omits them", async () => {
    mockedPrisma.product.findUnique.mockResolvedValue({
      id: "prod-1",
      tenantId: "tenant-1",
      externalId: "201",
      createdAt: new Date(Date.now() - 10000),
    });
    mockedPrisma.product.update.mockResolvedValue({});

    await syncProducts("tenant-1", [
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
    // Prisma skips undefined values — the fields must be undefined (not
    // set to null) so existing synced values are never wiped.
    expect(updateData.productUrl).toBeUndefined();
    expect(updateData.images).toBeUndefined();
    expect(updateData.category).toBeUndefined();
  });
});

// ─── Null stock handling ─────────────────────────────────────

describe("null stock handling", () => {
  it("preserves null stock when stock management is disabled (never converts to 0)", () => {
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

  it("marks out-of-stock products as unavailable even when stock is managed", () => {
    const cards = buildProductCards(
      [
        {
          ...mockCatalog[0],
          stock: 0,
        },
      ],
      ["prod-watch-1"]
    );
    expect(cards[0].available).toBe(false);
    expect(cards[0].stockManaged).toBe(true);
  });

  it("treats null stock as available (not managed/unknown), not out of stock", () => {
    const cards = buildProductCards(mockCatalog, ["prod-unmanaged-1"]);
    expect(cards[0].available).toBe(true);
    expect(cards[0].stockManaged).toBe(false);
  });
});

// ─── Structured product response ─────────────────────────────

describe("structured product response", () => {
  it("returns the full card shape with real product data", async () => {
    const res = await POST(
      makePostRequest({ message: "watch ache?", siteToken: SITE_TOKEN }, SITE_URL)
    );
    const data = await res.json();

    expect(data.success).toBe(true);
    expect(Array.isArray(data.products)).toBe(true);
    expect(data.products.length).toBeGreaterThan(0);

    const card = data.products[0];
    expect(card).toHaveProperty("id");
    expect(card).toHaveProperty("name");
    expect(card).toHaveProperty("price");
    expect(card).toHaveProperty("imageUrl");
    expect(card).toHaveProperty("productUrl");
    expect(card).toHaveProperty("available");
    expect(card).toHaveProperty("stock");
  });

  it("returns the real WooCommerce product URL (never constructed)", async () => {
    const res = await POST(
      makePostRequest({ message: "watch ache?", siteToken: SITE_TOKEN }, SITE_URL)
    );
    const data = await res.json();
    const watchCard = data.products.find(
      (p: AnyMock) => p.id === "prod-watch-1"
    );
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

  it("response text is clean — [PRODUCT:id] markers are stripped", async () => {
    const res = await POST(
      makePostRequest({ message: "watch ache?", siteToken: SITE_TOKEN }, SITE_URL)
    );
    const data = await res.json();
    expect(data.response).not.toContain("[PRODUCT:");
  });

  it("assistant message is stored WITH markers for follow-up context", async () => {
    await POST(makePostRequest({ message: "watch ache?", siteToken: SITE_TOKEN }, SITE_URL));
    const assistantCall = mockedPrisma.message.create.mock.calls.find(
      (call: AnyMock) => call[0].data.role === "assistant"
    );
    expect(assistantCall).toBeDefined();
    expect(assistantCall[0].data.content).toContain("[PRODUCT:prod-watch-1]");
  });
});

// ─── conversationId follow-up ────────────────────────────────

describe("conversationId follow-up", () => {
  it("extracts product IDs from [PRODUCT:id] markers in history", () => {
    const ids = extractProductIdsFromHistory([
      { role: "user", content: "watch ache?" },
      { role: "assistant", content: "Here are watches\n[PRODUCT:prod-watch-1]" },
    ]);
    expect(ids).toEqual(["prod-watch-1"]);
  });

  it("resolves 'black ta dekhaw' to the recently discussed product with a black variant", () => {
    const candidates = pickProducts(
      mockCatalog,
      "Black ta dekhaw",
      ["prod-watch-1"]
    );
    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates[0].id).toBe("prod-watch-1");
  });

  it("resolves Bangla color follow-ups ('kalo ta dekhaw')", () => {
    const candidates = pickProducts(mockCatalog, "Kalo ta dekhaw", ["prod-watch-1"]);
    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates[0].id).toBe("prod-watch-1");
  });

  it("budget queries filter products within the budget ('500 takar moddhe ki ache?')", () => {
    expect(extractBudget("500 takar moddhe ki ache?")).toBe(500);
    const candidates = pickProducts(mockCatalog, "500 takar moddhe ki ache?");
    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates.every((p) => Number(p.price) <= 500)).toBe(true);
  });

  it("understands Bangla product names via transliteration ('ghori' matches watch)", () => {
    // The alias list contains both the Bangla script and the Banglish form;
    // category detection works for either input.
    expect(detectCategoryKey("Ki ki ghori ache?")).toBe("watch");
    const candidates = pickProducts(mockCatalog, "Ki ki ghori ache?");
    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates[0].id).toBe("prod-watch-1");
  });

  it("extracts quantities including Bangla digits", () => {
    expect(extractQuantity("2 ta den")).toBe(2);
    expect(extractQuantity("৩টি lagbe")).toBe(3);
    expect(extractQuantity("no quantity here")).toBe(1);
  });

  it("detects colors in mixed Bangla/English", () => {
    expect(detectColor("Black ta dekhaw")).toBe("black");
    expect(detectColor("নীল color ache?")).toBe("blue");
    expect(detectColor("just a question")).toBeNull();
  });

  it("conversationId is returned and the conversation is not reset", async () => {
    const res1 = await POST(
      makePostRequest({ message: "watch ache?", siteToken: SITE_TOKEN }, SITE_URL)
    );
    const data1 = await res1.json();
    expect(data1.conversationId).toBe("conv-1");

    // Follow-up with the same conversationId
    const res2 = await POST(
      makePostRequest(
        { message: "black ta dekhaw", conversationId: data1.conversationId, siteToken: SITE_TOKEN },
        SITE_URL
      )
    );
    const data2 = await res2.json();
    expect(data2.conversationId).toBe("conv-1");
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

  it("answers pure greetings deterministically without querying products", async () => {
    const res = await POST(makePostRequest({ message: "hi", siteToken: SITE_TOKEN }, SITE_URL));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.response).toContain("Karta");
    expect(data.products).toEqual([]);
    // No catalog query and no LLM call for greetings
    expect(mockedPrisma.product.findMany).not.toHaveBeenCalled();
    expect(mockedProcessMessage).not.toHaveBeenCalled();
  });

  it("includes CORS headers on error responses", async () => {
    const res = await POST(makePostRequest({ siteToken: SITE_TOKEN }, SITE_URL));
    expect(res.status).toBe(400);
    expect(res.headers.get("access-control-allow-origin")).toBe(SITE_URL);
  });
});

// ─── Marker helpers ──────────────────────────────────────────

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
});

// ─── CORS helper (direct) ────────────────────────────────────

describe("fetchAllowedSiteUrls", () => {
  it("returns site URLs of active connections only", async () => {
    mockedPrisma.wooCommerceConnection.findMany.mockResolvedValue([
      { siteUrl: SITE_URL },
      { siteUrl: null },
    ]);
    const urls = await fetchAllowedSiteUrls();
    expect(urls).toEqual([SITE_URL]);
  });
});
