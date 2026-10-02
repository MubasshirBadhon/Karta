import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * Customer Intelligence + Persistent Conversation Layer — Focused Tests
 *
 * Covers: conversation persistence across navigation, visitor identity,
 * two-visitor isolation, tenant isolation, anonymous→Woo customer
 * linking, WhatsApp phone identity, event creation, recommendation
 * candidate generation/suppression/determinism, and privacy guarantees.
 */

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
      count: vi.fn().mockResolvedValue(0),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    product: {
      findUnique: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
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
    customer: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    order: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    message: {
      create: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
    },
  },
}));

vi.mock("@/lib/ai/commerce-engine", () => ({
  processMessage: vi.fn(),
}));

import { prisma } from "@/lib/db/prisma";
import { processMessage } from "@/lib/ai/commerce-engine";
import { POST as CHAT_POST, OPTIONS } from "@/app/api/chat/route";
import { GET as CONVERSATION_GET, DELETE as CONVERSATION_DELETE } from "@/app/api/chat/conversation/route";
import { POST as CUSTOMERS_POST } from "@/app/api/integrations/woocommerce/customers/route";
import { GET as ANALYTICS_GET } from "@/app/api/integrations/woocommerce/analytics/route";
import { trackEvent, getEventCounts } from "@/lib/intelligence/events";
import { getCustomerProfile, formatProfileForAI } from "@/lib/intelligence/profile";
import { linkVisitorToCustomer } from "@/lib/intelligence/identity-link";
import { normalizePhone, isValidVisitorId } from "@/lib/intelligence/identity";
import { getOrCreateCustomer } from "@/lib/channels/whatsapp/adapter";
import { recommend } from "@/lib/recommendations/engine";
import type { CatalogProduct } from "@/lib/commerce/catalog-matcher";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyMock = any;

const mockedPrisma = prisma as AnyMock;

const SITE_URL = "https://bd-deals.unaux.com";
const SITE_TOKEN = "kwc_demo_token";
const VISITOR_A = "kvid_" + "a".repeat(32);
const VISITOR_B = "kvid_" + "b".repeat(32);

const mockConnection = {
  id: "conn-1",
  tenantId: "tenant-1",
  connectionId: SITE_TOKEN,
  siteUrl: SITE_URL,
  siteName: "BD Deals",
  connectionSecret: "secret",
  status: "active",
  tenant: { inventoryMode: "unlimited" },
};

const makeCatalogProduct = (overrides: Partial<CatalogProduct> = {}): CatalogProduct => ({
  id: "prod-1",
  externalId: "101",
  name: "Classic Cotton T-Shirt",
  description: "Comfortable cotton t-shirt",
  price: 450,
  compareAtPrice: null,
  stock: null,
  stockStatus: "instock",
  manageStock: false,
  status: "active",
  image: null,
  productUrl: `${SITE_URL}/product/classic-cotton-t-shirt/`,
  sku: null,
  category: "Clothes",
  variants: [],
  ...overrides,
});

function makeChatRequest(body: Record<string, unknown>): Request {
  return new Request("https://karta-ozla.onrender.com/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json", origin: SITE_URL },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  // Reset the factory-level implementations that individual tests rely on
  mockedPrisma.wooCommerceConnection.findUnique.mockResolvedValue(mockConnection);
  mockedPrisma.wooCommerceConnection.findFirst.mockResolvedValue(mockConnection);
  mockedPrisma.wooCommerceConnection.findMany.mockResolvedValue([mockConnection]);
  mockedPrisma.conversation.findUnique.mockResolvedValue(null);
  mockedPrisma.conversation.findFirst.mockResolvedValue(null);
  mockedPrisma.conversation.findMany.mockResolvedValue([]);
  mockedPrisma.conversation.create.mockImplementation(({ data }: AnyMock) =>
    Promise.resolve({ id: "conv-new-" + Math.random().toString(36).slice(2, 8), ...data })
  );
  mockedPrisma.conversation.update.mockResolvedValue({});
  mockedPrisma.product.findMany.mockResolvedValue([makeCatalogProduct()]);
  mockedPrisma.customerEvent.findMany.mockResolvedValue([]);
  mockedPrisma.customerEvent.create.mockResolvedValue({});
  mockedPrisma.customerEvent.groupBy.mockResolvedValue([]);
  mockedPrisma.customer.findUnique.mockResolvedValue(null);
  mockedPrisma.customer.findFirst.mockResolvedValue(null);
  mockedPrisma.customer.create.mockImplementation(({ data }: AnyMock) =>
    Promise.resolve({ id: "cust-new-" + Math.random().toString(36).slice(2, 8), ...data })
  );
  mockedPrisma.customer.update.mockResolvedValue({});
  mockedPrisma.order.findMany.mockResolvedValue([]);
});

// ─── 1-5: Conversation persistence + visitor identity ────────

describe("website conversation persistence", () => {
  it("loads the visitor's conversation for page-navigation restore (1, 3)", async () => {
    mockedPrisma.conversation.findFirst.mockResolvedValue({
      id: "conv-visitor-1",
      tenantId: "tenant-1",
      channel: "web",
      visitorId: VISITOR_A,
      status: "active",
      metadata: { selectedProductId: "prod-1" },
      messages: [
        { role: "user", content: "t-shirt ki ache?" },
        { role: "assistant", content: "Here are some [PRODUCT:prod-1]" },
      ],
    });

    const res = await CONVERSATION_GET(
      new Request(`https://karta-ozla.onrender.com/api/chat/conversation?visitorId=${VISITOR_A}&siteToken=${SITE_TOKEN}`)
    );
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.conversationId).toBe("conv-visitor-1");
    expect(data.messages).toHaveLength(2);
    // The conversation query is scoped to the visitor
    expect(mockedPrisma.conversation.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ visitorId: VISITOR_A, channel: "web", status: "active" }),
      })
    );
  });

  it("strips internal [PRODUCT:id] markers from restored messages (3)", async () => {
    mockedPrisma.conversation.findFirst.mockResolvedValue({
      id: "conv-1",
      tenantId: "tenant-1",
      channel: "web",
      visitorId: VISITOR_A,
      status: "active",
      metadata: null,
      messages: [{ role: "assistant", content: "Here are some watches [PRODUCT:prod-1]" }],
    });

    const res = await CONVERSATION_GET(
      new Request(`https://karta-ozla.onrender.com/api/chat/conversation?visitorId=${VISITOR_A}&siteToken=${SITE_TOKEN}`)
    );
    const data = await res.json();

    expect(data.messages[0].content).not.toContain("[PRODUCT:");
    expect(data.messages[0].content).toContain("Here are some watches");
  });

  it("two visitors cannot access each other's conversations (4)", async () => {
    mockedPrisma.conversation.findFirst.mockResolvedValue(null);

    // Visitor B asks for their conversation — the query is scoped to
    // VISITOR_B, so Visitor A's conversation is never returned
    const res = await CONVERSATION_GET(
      new Request(`https://karta-ozla.onrender.com/api/chat/conversation?visitorId=${VISITOR_B}&siteToken=${SITE_TOKEN}`)
    );
    const data = await res.json();

    expect(data.conversationId).toBeNull();
    expect(mockedPrisma.conversation.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ visitorId: VISITOR_B }),
      })
    );
  });

  it("tenant isolation: the site token scopes every conversation query (5, 24)", async () => {
    const res = await CONVERSATION_GET(
      new Request(`https://karta-ozla.onrender.com/api/chat/conversation?visitorId=${VISITOR_A}&siteToken=${SITE_TOKEN}`)
    );
    expect(mockedPrisma.conversation.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ tenantId: "tenant-1" }),
      })
    );
  });

  it("rejects an invalid site token (5)", async () => {
    mockedPrisma.wooCommerceConnection.findUnique.mockResolvedValue(null);

    const res = await CONVERSATION_GET(
      new Request(`https://karta-ozla.onrender.com/api/chat/conversation?visitorId=${VISITOR_A}&siteToken=kwc_invalid`)
    );
    expect(res.status).toBe(401);
  });

  it("visitor ID format is validated (2) — never an IP address", () => {
    expect(isValidVisitorId("kvid_" + "a".repeat(32))).toBe(true);
    expect(isValidVisitorId("192.168.1.1")).toBe(false);
    expect(isValidVisitorId("kvid_short")).toBe(false);
  });

  it("clear conversation starts a NEW conversation and preserves history (23)", async () => {
    mockedPrisma.conversation.findFirst.mockResolvedValue({
      id: "conv-old",
      tenantId: "tenant-1",
      channel: "web",
      visitorId: VISITOR_A,
      status: "active",
    });

    const res = await CONVERSATION_DELETE(
      new Request("https://karta-ozla.onrender.com/api/chat/conversation", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ visitorId: VISITOR_A, siteToken: SITE_TOKEN }),
      })
    );
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
    // The old conversation is CLOSED (preserved for analytics), not deleted
    expect(mockedPrisma.conversation.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "closed" } })
    );
    // A new conversation is created
    expect(mockedPrisma.conversation.create).toHaveBeenCalled();
    expect(data.conversationId).toContain("conv-new-");
  });
});

// ─── 6: Anonymous → Woo customer merge ───────────────────────

describe("anonymous → WooCommerce customer merge", () => {
  it("links a visitor to a Woo customer and preserves conversation history (6)", async () => {
    mockedPrisma.customer.findFirst.mockResolvedValue({ id: "cust-woo-1" });
    mockedPrisma.customer.findUnique.mockResolvedValue({ id: "cust-woo-1" });
    mockedPrisma.conversation.updateMany.mockResolvedValue({ count: 3 });

    const result = await linkVisitorToCustomer("tenant-1", {
      visitorId: VISITOR_A,
      wooCustomerId: "123",
      email: "customer@example.com",
    });

    expect(result.success).toBe(true);
    expect(result.customerId).toBe("cust-woo-1");
    // The visitor's previous conversations are re-linked (history preserved)
    expect(result.linkedConversations).toBe(3);
    expect(mockedPrisma.conversation.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ visitorId: VISITOR_A, customerId: null }),
        data: { customerId: "cust-woo-1" },
      })
    );
  });

  it("creates a customer when none exists", async () => {
    mockedPrisma.customer.findFirst.mockResolvedValue(null);
    mockedPrisma.customer.create.mockResolvedValue({ id: "cust-new-1" });
    mockedPrisma.conversation.updateMany.mockResolvedValue({ count: 0 });

    const result = await linkVisitorToCustomer("tenant-1", {
      visitorId: VISITOR_A,
      email: "new@example.com",
    });

    expect(result.success).toBe(true);
    expect(result.customerId).toBe("cust-new-1");
  });

  it("refuses to link without a reliable identity signal (6)", async () => {
    const result = await linkVisitorToCustomer("tenant-1", { visitorId: VISITOR_A });

    expect(result.success).toBe(false);
    expect(result.error).toContain("reliable identity signal");
    expect(mockedPrisma.customer.create).not.toHaveBeenCalled();
  });

  it("the customer link endpoint is HMAC-protected", async () => {
    const res = await CUSTOMERS_POST(
      new Request("https://karta-ozla.onrender.com/api/integrations/woocommerce/customers", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ visitorId: VISITOR_A, email: "x@example.com" }),
      })
    );
    expect(res.status).toBe(401);
  });

  it("the customer link endpoint merges on authorized calls", async () => {
    const crypto = await import("crypto");
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const signature = crypto.createHmac("sha256", "secret").update("conn-1" + timestamp).digest("hex");

    mockedPrisma.customer.findFirst.mockResolvedValue(null);
    mockedPrisma.customer.create.mockResolvedValue({ id: "cust-new-2" });

    const res = await CUSTOMERS_POST(
      new Request("https://karta-ozla.onrender.com/api/integrations/woocommerce/customers", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "X-Karta-Connection-Id": "conn-1",
          "X-Karta-Timestamp": timestamp,
          "X-Karta-Signature": signature,
        },
        body: JSON.stringify({ visitorId: VISITOR_A, email: "x@example.com" }),
      })
    );
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
  });
});

// ─── 7-9: WhatsApp identity ──────────────────────────────────

describe("WhatsApp phone → customer identity", () => {
  it("maps tenantId + phone to a Karta customer (7)", async () => {
    mockedPrisma.customer.findFirst.mockResolvedValue({ id: "cust-wa-1" });

    const customer = await getOrCreateCustomer("tenant-1", "+8801711000000");

    expect(customer.id).toBe("cust-wa-1");
    expect(mockedPrisma.customer.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ tenantId: "tenant-1" }),
      })
    );
  });

  it("the same phone reuses the same customer (8)", async () => {
    mockedPrisma.customer.findFirst
      .mockResolvedValueOnce({ id: "cust-wa-1" })
      .mockResolvedValueOnce({ id: "cust-wa-1" });

    const c1 = await getOrCreateCustomer("tenant-1", "+8801711000000");
    const c2 = await getOrCreateCustomer("tenant-1", "+8801711000000");

    expect(c1.id).toBe(c2.id);
    expect(mockedPrisma.customer.create).not.toHaveBeenCalled();
  });

  it("a different phone creates a different customer (9)", async () => {
    mockedPrisma.customer.findFirst.mockResolvedValue(null);
    let counter = 0;
    mockedPrisma.customer.create.mockImplementation(() => {
      counter++;
      return Promise.resolve({ id: "cust-wa-" + counter });
    });

    const c1 = await getOrCreateCustomer("tenant-1", "+8801711000000");
    const c2 = await getOrCreateCustomer("tenant-1", "+8801722000000");

    expect(c1.id).not.toBe(c2.id);
    expect(mockedPrisma.customer.create).toHaveBeenCalledTimes(2);
  });

  it("phone numbers are normalized (E.164-ish)", () => {
    expect(normalizePhone("+8801711 000 000")).toBe("+8801711000000");
    expect(normalizePhone("8801711000000")).toBe("8801711000000");
    expect(normalizePhone("01 711-000-000")).toBe("01711000000");
    expect(normalizePhone("")).toBe("");
    expect(normalizePhone(null)).toBe("");
  });
});

// ─── 10-14: Events ───────────────────────────────────────────

describe("customer events", () => {
  it("creates events with structured metadata (10)", async () => {
    await trackEvent("tenant-1", {
      type: "MESSAGE_SENT",
      visitorId: VISITOR_A,
      metadata: { channel: "web" },
    });

    expect(mockedPrisma.customerEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tenantId: "tenant-1",
          visitorId: VISITOR_A,
          type: "MESSAGE_SENT",
        }),
      })
    );
  });

  it("product search events carry query/category/budget (11)", async () => {
    await trackEvent("tenant-1", {
      type: "PRODUCT_SEARCHED",
      visitorId: VISITOR_A,
      metadata: { query: "t-shirt under 500", category: "clothes", budget: 500 },
    });

    expect(mockedPrisma.customerEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: "PRODUCT_SEARCHED",
          metadata: expect.objectContaining({ query: "t-shirt under 500", budget: 500 }),
        }),
      })
    );
  });

  it("product click events carry productId (12)", async () => {
    await trackEvent("tenant-1", {
      type: "PRODUCT_CLICKED",
      visitorId: VISITOR_A,
      metadata: { productId: "prod-1" },
    });

    expect(mockedPrisma.customerEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: "PRODUCT_CLICKED",
          metadata: expect.objectContaining({ productId: "prod-1" }),
        }),
      })
    );
  });

  it("add-to-cart events carry productId/variationId/quantity (13)", async () => {
    await trackEvent("tenant-1", {
      type: "PRODUCT_ADDED_TO_CART",
      visitorId: VISITOR_A,
      metadata: { productId: "101", variationId: "501", quantity: 2 },
    });

    expect(mockedPrisma.customerEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: "PRODUCT_ADDED_TO_CART",
          metadata: expect.objectContaining({ productId: "101", quantity: 2 }),
        }),
      })
    );
  });

  it("order completion events carry orderId/value (14)", async () => {
    await trackEvent("tenant-1", {
      type: "ORDER_COMPLETED",
      customerId: "cust-1",
      metadata: { orderId: "order-1", value: 2500, items: 2 },
    });

    expect(mockedPrisma.customerEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: "ORDER_COMPLETED",
          metadata: expect.objectContaining({ orderId: "order-1" }),
        }),
      })
    );
  });

  it("analytics counts are aggregated and tenant-isolated (12)", async () => {
    mockedPrisma.customerEvent.groupBy.mockResolvedValue([
      { type: "MESSAGE_SENT", _count: { type: 10 } },
      { type: "PRODUCT_SEARCHED", _count: { type: 4 } },
      { type: "PRODUCT_ADDED_TO_CART", _count: { type: 2 } },
    ]);
    mockedPrisma.customerEvent.findMany
      .mockResolvedValueOnce([{ visitorId: VISITOR_A }, { visitorId: VISITOR_B }])
      .mockResolvedValueOnce([{ customerId: "cust-1" }]);

    const counts = await getEventCounts("tenant-1");

    expect(counts.conversations).toBe(0);
    expect(counts.uniqueVisitors).toBe(2);
    expect(counts.uniqueCustomers).toBe(1);
    expect(counts.productsSearched).toBe(4);
    expect(counts.addToCart).toBe(2);
  });

  it("the analytics endpoint is HMAC-protected", async () => {
    const res = await ANALYTICS_GET(
      new Request("https://karta-ozla.onrender.com/api/integrations/woocommerce/analytics")
    );
    expect(res.status).toBe(401);
  });
});

// ─── 15-21: Recommendation engine ────────────────────────────

describe("recommendation engine", () => {
  it("generates candidates with scores and reasons (15)", () => {
    const recs = recommend({
      category: "clothes",
      catalog: [makeCatalogProduct()],
      inventoryMode: "unlimited",
    });

    expect(recs).toHaveLength(1);
    expect(recs[0].score).toBeGreaterThan(0);
    expect(recs[0].reason).toContain("matches");
  });

  it("unavailable products are never recommended (16)", () => {
    const recs = recommend({
      category: "clothes",
      catalog: [makeCatalogProduct({ stock: 0, stockStatus: "outofstock", manageStock: true })],
      inventoryMode: "managed",
    });

    expect(recs).toEqual([]);
  });

  it("archived products are never recommended (17)", () => {
    const recs = recommend({
      category: "clothes",
      catalog: [makeCatalogProduct({ status: "archived" })],
      inventoryMode: "unlimited",
    });

    expect(recs).toEqual([]);
  });

  it("budget-compatible products score higher (18)", () => {
    const recs = recommend({
      budget: 500,
      catalog: [
        makeCatalogProduct({ id: "prod-cheap", price: 450 }),
        makeCatalogProduct({ id: "prod-pricey", price: 2000, name: "Premium Watch", category: "Wearables" }),
      ],
      inventoryMode: "unlimited",
    });

    const cheap = recs.find((r) => r.product.id === "prod-cheap");
    const pricey = recs.find((r) => r.product.id === "prod-pricey");
    expect(cheap).toBeDefined();
    expect(cheap!.score).toBeGreaterThan(pricey?.score ?? 0);
  });

  it("dismissed products are suppressed (19)", () => {
    const recs = recommend({
      profile: {
        interestedCategories: [],
        viewedProductIds: [],
        clickedProductIds: [],
        recentlyRecommendedIds: [],
        dismissedProductIds: ["prod-1"],
        cartItems: [],
        recentSearches: [],
        budgetSignals: [],
        purchasedCategoryCounts: {},
        purchaseHistory: [],
        lastInteractionAt: null,
        preferredChannel: null,
      },
      category: "clothes",
      catalog: [makeCatalogProduct()],
      inventoryMode: "unlimited",
    });

    expect(recs).toEqual([]);
  });

  it("the currently discussed product is excluded from also-like suggestions", () => {
    const recs = recommend({
      category: "clothes",
      currentProductId: "prod-1",
      catalog: [makeCatalogProduct()],
      inventoryMode: "unlimited",
    });

    expect(recs).toEqual([]);
  });

  it("complementary products are recommended with a reason", () => {
    const recs = recommend({
      currentProductId: "prod-1",
      catalog: [
        makeCatalogProduct(),
        makeCatalogProduct({
          id: "prod-jeans",
          name: "Everyday Denim Jeans",
          category: "Clothes",
          description: "Relaxed denim that pairs with any t-shirt",
          price: 1200,
        }),
      ],
      inventoryMode: "unlimited",
    });

    const jeans = recs.find((r) => r.product.id === "prod-jeans");
    expect(jeans).toBeDefined();
    expect(jeans!.score).toBeGreaterThan(0);
  });

  it("candidates are deterministic — the same input gives the same output (21)", () => {
    const input = {
      category: "clothes",
      budget: 500,
      catalog: [makeCatalogProduct(), makeCatalogProduct({ id: "prod-2", name: "Other Shirt", price: 300 })],
      inventoryMode: "unlimited" as const,
    };

    const r1 = recommend(input);
    const r2 = recommend(input);

    expect(r1).toEqual(r2);
  });

  it("the AI cannot invent recommendation products (20) — candidates come only from the engine", async () => {
    // The chat route's product search never calls the LLM for candidates
    const { processMessage } = await import("@/lib/ai/commerce-engine");
    const mocked = processMessage as AnyMock;
    mocked.mockRejectedValue(new Error("LLM should never be called for candidates"));

    const res = await CHAT_POST(
      makeChatRequest({ message: "T-shirt ki ache?", siteToken: SITE_TOKEN, visitorId: VISITOR_A })
    );
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.products.length).toBeGreaterThan(0);
    // The LLM was never called — candidates are deterministic
    expect(mocked).not.toHaveBeenCalled();
  });

  it("product-name words are a search signal even without category aliases", async () => {
    // "mug" is not in the category alias list — but the product name
    // contains it, so the deterministic search handles it (not the LLM)
    mockedPrisma.product.findMany.mockResolvedValue([
      makeCatalogProduct({
        id: "prod-mug",
        externalId: "29",
        name: "Ceramic Coffee Mug (12oz)",
        category: "Kitchen",
        price: 12.99,
      }),
    ]);

    const res = await CHAT_POST(
      makeChatRequest({ message: "mug ache?", siteToken: SITE_TOKEN, visitorId: VISITOR_A })
    );
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.intent).toBe("PRODUCT_SEARCH");
    expect(data.products.length).toBeGreaterThan(0);
    expect(data.products[0].name).toContain("Mug");
    // The LLM was never called — the name match is deterministic
    expect(processMessage).not.toHaveBeenCalled();
  });
});

// ─── 22: Privacy / profile ───────────────────────────────────

describe("privacy / profile", () => {
  it("the profile derives only behavioral facts — no sensitive inference (22)", async () => {
    mockedPrisma.customerEvent.findMany.mockReset().mockResolvedValue([
      { type: "PRODUCT_SEARCHED", metadata: { query: "t-shirt", category: "clothes", budget: 500 }, createdAt: new Date() },
      { type: "PRODUCT_VIEWED", metadata: { productId: "prod-1" }, createdAt: new Date() },
    ]);
    mockedPrisma.conversation.findMany.mockReset().mockResolvedValue([
      {
        channel: "web",
        messages: [{ role: "user", content: "500 takar moddhe ki ache?", createdAt: new Date() }],
      },
    ]);

    const profile = await getCustomerProfile("tenant-1", { visitorId: VISITOR_A });

    expect(profile.interestedCategories).toContain("clothes");
    expect(profile.viewedProductIds).toContain("prod-1");
    expect(profile.budgetSignals.length).toBeGreaterThan(0);
    // No sensitive/personal attributes are derived
    const serialized = JSON.stringify(profile);
    expect(serialized).not.toContain("ip");
    expect(serialized).not.toContain("password");
    expect(serialized).not.toContain("mentalState");
  });

  it("the AI context is a compact summary (9) — not a behavior blob", () => {
    const profile = {
      interestedCategories: ["clothes"],
      viewedProductIds: ["prod-1", "prod-2"],
      clickedProductIds: [],
      recentlyRecommendedIds: [],
      dismissedProductIds: [],
      cartItems: [],
      recentSearches: ["t-shirt under 500"],
      budgetSignals: [500],
      purchasedCategoryCounts: {},
      purchaseHistory: [],
      lastInteractionAt: null,
      preferredChannel: "web",
    };

    const summary = formatProfileForAI(profile as AnyMock);

    // Compact: a few short lines
    expect(summary.split("\n").length).toBeLessThanOrEqual(5);
    expect(summary).toContain("clothes");
    expect(summary).toContain("500");
  });

  it("no secrets are exposed in chat responses (13)", async () => {
    const res = await CHAT_POST(
      makeChatRequest({ message: "hi", siteToken: SITE_TOKEN, visitorId: VISITOR_A })
    );
    const data = await res.json();
    const serialized = JSON.stringify(data);

    expect(serialized).not.toContain("karta_secret");
    expect(serialized).not.toContain("connectionSecret");
    expect(serialized).not.toContain("GROQ_API_KEY");
    expect(serialized).not.toContain("gsk_");
    expect(serialized).not.toContain("tenant-1");
  });

  it("OPTIONS preflight still works (cross-origin widget)", async () => {
    const res = await OPTIONS(
      new Request("https://karta-ozla.onrender.com/api/chat", {
        method: "OPTIONS",
        headers: { origin: SITE_URL, "access-control-request-method": "POST" },
      })
    );
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe(SITE_URL);
  });
});
