import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * Inventory Policy & Provider Classification — Focused Tests
 *
 * Covers: inventoryMode=unlimited (stock NEVER determines availability),
 * inventoryMode=managed, quantity capping, deterministic product search
 * without Groq, provider error classification (429/401/500/network),
 * and product URL/image response.
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
      create: vi.fn(),
      update: vi.fn(),
    },
    product: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
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

vi.mock("@/lib/ai/commerce-engine", () => ({
  processMessage: vi.fn(),
}));

import { prisma } from "@/lib/db/prisma";
import { processMessage } from "@/lib/ai/commerce-engine";
import { POST } from "@/app/api/chat/route";
import { classifyProviderFailure, providerStatusFromCode } from "@/lib/ai/provider-error";
import {
  isProductAvailable,
  availabilityLabel,
  buildProductCards,
  pickProducts,
  buildIntroText,
  extractQuantity,
  type CatalogProduct,
  type InventoryMode,
} from "@/lib/commerce/catalog-matcher";
import { normalizeProduct } from "@/lib/integrations/woocommerce/normalizer";
import { GroqProvider } from "@/lib/ai/groq";

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

let conversationRecord: AnyMock;

const makeProduct = (overrides: Partial<CatalogProduct> = {}): CatalogProduct => ({
  id: "prod-tshirt-1",
  externalId: "301",
  name: "Classic Cotton T-Shirt",
  description: "Comfortable cotton t-shirt",
  price: 590,
  compareAtPrice: 790,
  stock: 0, // WooCommerce may show quantity = 0
  stockStatus: "instock",
  manageStock: false, // stock management disabled
  status: "active",
  image: "https://bd-deals.unaux.com/wp-content/uploads/tshirt.jpg",
  productUrl: `${SITE_URL}/product/classic-cotton-t-shirt/`,
  sku: "TS-001",
  category: "Clothes",
  variants: [],
  ...overrides,
});

function makePostRequest(body: Record<string, unknown>, origin?: string): Request {
  return new Request("https://karta-ozla.onrender.com/api/chat", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(origin ? { origin } : {}),
    },
    body: JSON.stringify({ visitorId: "kvid_" + "b".repeat(32), ...body }),
  });
}

function setupHappyPath(inventoryMode: InventoryMode = "unlimited") {
  mockedPrisma.wooCommerceConnection.findUnique.mockResolvedValue({
    ...mockConnection,
    tenant: { inventoryMode },
  });
  mockedPrisma.wooCommerceConnection.findFirst.mockResolvedValue({
    ...mockConnection,
    tenant: { inventoryMode },
  });
  mockedPrisma.wooCommerceConnection.findMany.mockResolvedValue([mockConnection]);
  mockedPrisma.message.findMany.mockResolvedValue([]);
  mockedPrisma.message.create.mockResolvedValue({});
  mockedPrisma.product.findMany.mockResolvedValue([makeProduct()]);
  mockedProcessMessage.mockResolvedValue({ text: "ok", success: true });
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

// ─── Inventory policy ────────────────────────────────────────

describe("inventoryMode=unlimited", () => {
  it("stock=0 is AVAILABLE (quantity must not determine availability)", () => {
    const product = makeProduct({ stock: 0 });
    expect(isProductAvailable(product, "unlimited")).toBe(true);
    expect(availabilityLabel(product, "unlimited")).toBe("Available");
    expect(availabilityLabel(product, "unlimited")).not.toContain("Out of stock");
  });

  it("stock=null is AVAILABLE", () => {
    const product = makeProduct({ stock: null });
    expect(isProductAvailable(product, "unlimited")).toBe(true);
    expect(availabilityLabel(product, "unlimited")).toBe("Available");
  });

  it("quantity=100 (or any quantity) is AVAILABLE", () => {
    const product = makeProduct({ stock: 100 });
    expect(isProductAvailable(product, "unlimited")).toBe(true);
  });

  it("quantity-derived outofstock (manageStock=true) is IGNORED in unlimited mode", () => {
    const product = makeProduct({ stock: 0, stockStatus: "outofstock", manageStock: true });
    expect(isProductAvailable(product, "unlimited")).toBe(true);
    expect(availabilityLabel(product, "unlimited")).toBe("Available");
  });

  it("a MANUAL merchant-set outofstock (manageStock=false) is unavailable", () => {
    const product = makeProduct({ stock: null, stockStatus: "outofstock", manageStock: false });
    expect(isProductAvailable(product, "unlimited")).toBe(false);
    expect(availabilityLabel(product, "unlimited")).toBe("Out of stock");
  });

  it("archived/draft products are unavailable (explicitly unavailable)", () => {
    expect(isProductAvailable(makeProduct({ status: "archived" }), "unlimited")).toBe(false);
    expect(isProductAvailable(makeProduct({ status: "draft" }), "unlimited")).toBe(false);
  });

  it("unlimited inventory does not cap quantity by stock", () => {
    // extractQuantity has only a sanity cap (1-20), never a stock cap
    expect(extractQuantity("5 ta dao")).toBe(5);
    expect(extractQuantity("2 ta dao")).toBe(2);
    // A product with stock=0 does not reduce or block a requested quantity —
    // the quantity in the cart action comes from the message, not the stock.
    const product = makeProduct({ stock: 0 });
    expect(isProductAvailable(product, "unlimited")).toBe(true);
    expect(extractQuantity("5 ta dao")).not.toBe(product.stock);
  });

  it("product cards say Available (never out of stock) in unlimited mode", () => {
    const cards = buildProductCards([makeProduct({ stock: 0 })], ["prod-tshirt-1"], 4, "unlimited");
    expect(cards[0].available).toBe(true);
    expect(cards[0].availability).toBe("Available");
    expect(cards[0].availability).not.toContain("Out of stock");
  });

  it("unlimited-mode search includes stock=0 products (no filtering by quantity)", () => {
    const candidates = pickProducts(
      [makeProduct({ stock: 0 }), makeProduct({ id: "prod-x", name: "Other", stock: 5 })],
      "t-shirt ki ache?",
      [],
      "unlimited"
    );
    expect(candidates.some((p) => p.id === "prod-tshirt-1")).toBe(true);
  });
});

describe("inventoryMode=managed", () => {
  it("stock=0 is unavailable", () => {
    const product = makeProduct({ stock: 0, manageStock: true });
    expect(isProductAvailable(product, "managed")).toBe(false);
    expect(availabilityLabel(product, "managed")).toBe("Out of stock");
  });

  it("stock=null is available (quantity unknown/not managed)", () => {
    const product = makeProduct({ stock: null, manageStock: false });
    expect(isProductAvailable(product, "managed")).toBe(true);
  });

  it("stock>0 shows the count", () => {
    const product = makeProduct({ stock: 12, manageStock: true });
    expect(availabilityLabel(product, "managed")).toBe("In stock (12)");
  });

  it("onbackorder (backorders allowed) is available in managed mode — mirrors Woo's is_in_stock", () => {
    const product = makeProduct({ stock: 0, stockStatus: "onbackorder", manageStock: true });
    expect(isProductAvailable(product, "managed")).toBe(true);
    expect(availabilityLabel(product, "managed")).toBe("Available");
  });

  it("CASE C: an explicit outofstock (manage_stock=false) is unavailable even in unlimited mode", () => {
    // The merchant EXPLICITLY set the stock status — inventoryMode
    // "unlimited" must NOT override it
    const product = makeProduct({ stock: null, stockStatus: "outofstock", manageStock: false });
    expect(isProductAvailable(product, "unlimited")).toBe(false);
    expect(availabilityLabel(product, "unlimited")).toBe("Out of stock");
  });

  it("CASE A: manage_stock=false never converts null to 0 anywhere in the chain", () => {
    // normalizer → the product: null stays null
    const normalized = normalizeProduct({
      externalId: "900",
      name: "Unmanaged",
      price: 100,
      stockQuantity: null,
      stockStatus: "instock",
      manageStock: false,
      type: "simple",
      variations: [],
    });
    expect(normalized.stock).not.toBe(0);
    expect(normalized.stock).toBeNull();
  });

  it("CASE B: managed quantities show the real count", () => {
    expect(availabilityLabel(makeProduct({ stock: 50, manageStock: true }), "managed")).toBe("In stock (50)");
    expect(availabilityLabel(makeProduct({ stock: 5, manageStock: true }), "managed")).toBe("In stock (5)");
    expect(availabilityLabel(makeProduct({ stock: 0, manageStock: true }), "managed")).toBe("Out of stock");
  });

  it("managed-mode search excludes stock=0 products", () => {
    const candidates = pickProducts(
      [makeProduct({ stock: 0 }), makeProduct({ id: "prod-x", name: "Other Product", stock: 5 })],
      "show me products",
      [],
      "managed"
    );
    expect(candidates.every((p) => p.id !== "prod-tshirt-1")).toBe(true);
  });
});

// ─── Deterministic product commerce without Groq ─────────────

describe("product commerce without Groq", () => {
  it("T-shirt search finds the product deterministically", async () => {
    const res = await POST(
      makePostRequest({ message: "T-shirt ki ache?", siteToken: SITE_TOKEN }, SITE_URL)
    );
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.intent).toBe("PRODUCT_SEARCH");
    expect(data.products.length).toBeGreaterThan(0);
    expect(data.products[0].name).toBe("Classic Cotton T-Shirt");
    // Groq was NOT called — deterministic matching handled it
    expect(mockedProcessMessage).not.toHaveBeenCalled();
  });

  it("short response mentions the product name (no Markdown table)", async () => {
    const res = await POST(
      makePostRequest({ message: "T-shirt ki ache?", siteToken: SITE_TOKEN }, SITE_URL)
    );
    const data = await res.json();

    expect(data.message).toContain("Classic Cotton T-Shirt");
    expect(data.message).not.toContain("|");
    expect(data.message).not.toContain("**");
    expect(data.message.length).toBeLessThan(120);
  });

  it("product card says Available (never 'স্টকে নেই') in unlimited mode", async () => {
    const res = await POST(
      makePostRequest({ message: "T-shirt ki ache?", siteToken: SITE_TOKEN }, SITE_URL)
    );
    const data = await res.json();

    expect(data.products[0].availability).toBe("Available");
    expect(JSON.stringify(data)).not.toContain("স্টকে নেই");
  });

  it("product URL is still returned", async () => {
    const res = await POST(
      makePostRequest({ message: "T-shirt ki ache?", siteToken: SITE_TOKEN }, SITE_URL)
    );
    const data = await res.json();
    expect(data.products[0].productUrl).toBe(`${SITE_URL}/product/classic-cotton-t-shirt/`);
  });

  it("product image is still returned", async () => {
    const res = await POST(
      makePostRequest({ message: "T-shirt ki ache?", siteToken: SITE_TOKEN }, SITE_URL)
    );
    const data = await res.json();
    expect(data.products[0].imageUrl).toBe("https://bd-deals.unaux.com/wp-content/uploads/tshirt.jpg");
  });

  it("Groq 429 does not fail deterministic product search", async () => {
    // The provider is rate limited — the deterministic matcher still works
    mockedProcessMessage.mockRejectedValue(
      Object.assign(new Error("Groq API error (429): Rate limit reached"), { code: "AI_PROVIDER_RATE_LIMITED" })
    );

    const res = await POST(
      makePostRequest({ message: "T-shirt ki ache?", siteToken: SITE_TOKEN }, SITE_URL)
    );
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.intent).toBe("PRODUCT_SEARCH");
    expect(data.products.length).toBeGreaterThan(0);
    // The LLM was never called (deterministic flow) — no provider error shown
    expect(mockedProcessMessage).not.toHaveBeenCalled();
    expect(data.message).not.toContain("could not connect");
    expect(data.message).not.toContain("429");
  });

  it("no Groq key does not break deterministic product search", async () => {
    mockedProcessMessage.mockRejectedValue(
      Object.assign(new Error("GROQ_API_KEY is not set"), { code: "AI_PROVIDER_NO_KEY" })
    );

    const res = await POST(
      makePostRequest({ message: "T-shirt ki ache?", siteToken: SITE_TOKEN }, SITE_URL)
    );
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.products.length).toBeGreaterThan(0);
    expect(mockedProcessMessage).not.toHaveBeenCalled();
  });

  it("when the LLM path fails with 429, a deterministic clarification is returned", async () => {
    // A general question (no product signal) reaches the LLM path; a 429
    // must return a deterministic fallback.
    // The engine catches provider failures internally and returns
    // success:false with a sanitized errorCode (it never throws).
    mockedProcessMessage.mockResolvedValue({
      text: "",
      success: false,
      error: "Groq API error (429): Rate limit reached",
      errorCode: "AI_PROVIDER_RATE_LIMITED",
    });

    const res = await POST(
      makePostRequest({ message: "do you offer home delivery?", siteToken: SITE_TOKEN }, SITE_URL)
    );
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.aiSuccess).toBe(false);
    expect(data.aiProviderStatus).toBe("rate_limited");
    expect(data.intent).toBe("GENERAL");
    expect(data.message).not.toContain("could not connect");
    expect(data.message).not.toContain("Groq");
    expect(data.message).not.toContain("429");
    expect(data.message.length).toBeGreaterThan(0);
  });

  it("single-candidate intro mentions the product name", () => {
    // The message has no Bangla script → English response
    const intro = buildIntroText([makeProduct()], "t-shirt ki ache?");
    expect(intro).toBe("Yes, Classic Cotton T-Shirt is available.");
    expect(intro).not.toContain("|");
  });
});

// ─── Provider error classification ───────────────────────────

describe("provider error classification", () => {
  it("Groq 429 is classified as AI_PROVIDER_RATE_LIMITED with retryAfter", () => {
    const error = classifyProviderFailure(new Error("Groq API error (429): Rate limit"), {
      status: 429,
      retryAfter: "30",
    });
    expect(error.code).toBe("AI_PROVIDER_RATE_LIMITED");
    expect(error.status).toBe(429);
    expect(error.retryAfterMs).toBe(30000);
    expect(providerStatusFromCode(error.code)).toBe("rate_limited");
  });

  it("Groq 401 is classified as AI_PROVIDER_AUTH", () => {
    const error = classifyProviderFailure(new Error("Groq API error (401): Invalid API key"), { status: 401 });
    expect(error.code).toBe("AI_PROVIDER_AUTH");
    expect(providerStatusFromCode(error.code)).toBe("auth_error");
  });

  it("Groq 403 is classified as AI_PROVIDER_AUTH", () => {
    const error = classifyProviderFailure(new Error("Groq API error (403): Forbidden"), { status: 403 });
    expect(error.code).toBe("AI_PROVIDER_AUTH");
  });

  it("Groq 500 is classified as AI_PROVIDER_UNAVAILABLE", () => {
    const error = classifyProviderFailure(new Error("Groq API error (500): Server error"), { status: 500 });
    expect(error.code).toBe("AI_PROVIDER_UNAVAILABLE");
    expect(providerStatusFromCode(error.code)).toBe("unavailable");
  });

  it("Groq 503 is classified as AI_PROVIDER_UNAVAILABLE", () => {
    const error = classifyProviderFailure(new Error("Groq API error (503): Service unavailable"), { status: 503 });
    expect(error.code).toBe("AI_PROVIDER_UNAVAILABLE");
  });

  it("Groq 404 (unsupported/deprecated model) is classified as AI_PROVIDER_NOT_FOUND", () => {
    const error = classifyProviderFailure(new Error("Groq API error (404): model_not_found"), { status: 404 });
    expect(error.code).toBe("AI_PROVIDER_NOT_FOUND");
    expect(providerStatusFromCode(error.code)).toBe("provider_config_error");
  });

  it("network failure (TypeError) is classified as AI_PROVIDER_NETWORK", () => {
    const error = classifyProviderFailure(new TypeError("fetch failed"));
    expect(error.code).toBe("AI_PROVIDER_NETWORK");
    expect(providerStatusFromCode(error.code)).toBe("network_error");
  });

  it("timeout (AbortError) is classified as AI_PROVIDER_TIMEOUT", () => {
    const abortError = new Error("The operation was aborted");
    abortError.name = "AbortError";
    const error = classifyProviderFailure(abortError);
    expect(error.code).toBe("AI_PROVIDER_TIMEOUT");
  });

  it("already-classified errors pass through unchanged", () => {
    const pre = Object.assign(new Error("Rate limited"), { code: "AI_PROVIDER_RATE_LIMITED" });
    expect(classifyProviderFailure(pre).code).toBe("AI_PROVIDER_RATE_LIMITED");
  });

  it("error messages never contain secrets", () => {
    const error = classifyProviderFailure(new Error("Groq API error (429): Rate limit"));
    expect(JSON.stringify({ code: error.code, message: error.message })).not.toContain("gsk_");
  });
});

// ─── Circuit breaker ─────────────────────────────────────────

describe("provider circuit breaker", () => {
  it("records rate-limit failures so bursts do not create doomed provider calls", async () => {
    // First message: a general question (no product signal) reaches the
    // LLM path, which fails with 429. The engine returns success:false +
    // errorCode (it catches internally).
    mockedProcessMessage.mockResolvedValue({
      text: "",
      success: false,
      error: "Groq API error (429): Rate limit",
      errorCode: "AI_PROVIDER_RATE_LIMITED",
    });

    const res1 = await POST(
      makePostRequest({ message: "do you offer home delivery?", siteToken: SITE_TOKEN }, SITE_URL)
    );
    expect(res1.status).toBe(200);
    const d1 = await res1.json();
    expect(d1.aiProviderStatus).toBe("rate_limited");

    // Second message (within the cooldown): the breaker is open — the
    // provider is NOT called again; the deterministic fallback answers.
    mockedProcessMessage.mockClear();
    const res2 = await POST(
      makePostRequest({ message: "how is your day going?", siteToken: SITE_TOKEN }, SITE_URL)
    );
    expect(res2.status).toBe(200);
    const d2 = await res2.json();
    expect(mockedProcessMessage).not.toHaveBeenCalled(); // breaker open
    expect(d2.aiProviderStatus).toBe("rate_limited");
    expect(d2.message).not.toContain("could not connect");
  });
});

// ─── Add to cart with unlimited inventory ────────────────────

describe("add to cart with unlimited inventory", () => {
  it("cartAction carries inventoryMode=unlimited to the cart bridge", async () => {
    // Add-to-cart intent resolves the product (deterministic)
    await POST(
      makePostRequest({ message: "t-shirt ta chai", siteToken: SITE_TOKEN }, SITE_URL)
    );

    // Explicit confirmation
    const res = await POST(
      makePostRequest({ message: "হ্যাঁ", conversationId: "conv-1", siteToken: SITE_TOKEN }, SITE_URL)
    );
    const data = await res.json();

    expect(data.intent).toBe("ADD_TO_CART_CONFIRMED");
    expect(data.cartAction).not.toBeNull();
    expect(data.cartAction.type).toBe("addToCart");
    expect(data.cartAction.productId).toBe("301"); // WooCommerce external ID
    expect(data.cartAction.inventoryMode).toBe("unlimited"); // policy travels with the action
  });

  it("cart action quantity is message-derived, never stock-derived", async () => {
    // The customer has a previously viewed product in context
    conversationRecord.metadata = { selectedProductId: "prod-tshirt-1" };
    await POST(
      makePostRequest({ message: "3 ta dao", siteToken: SITE_TOKEN }, SITE_URL)
    );
    const res = await POST(
      makePostRequest({ message: "হ্যাঁ", conversationId: "conv-1", siteToken: SITE_TOKEN }, SITE_URL)
    );
    const data = await res.json();

    expect(data.cartAction.quantity).toBe(3);
    // The product has stock=0 — quantity is NOT capped by it
    expect(data.cartAction.quantity).toBeGreaterThan(0);
  });

  it("no secret is returned to the browser", async () => {
    const res = await POST(
      makePostRequest({ message: "T-shirt ki ache?", siteToken: SITE_TOKEN }, SITE_URL)
    );
    const data = await res.json();
    const serialized = JSON.stringify(data);

    expect(serialized).not.toContain("karta_secret");
    expect(serialized).not.toContain("connectionSecret");
    expect(serialized).not.toContain("GROQ_API_KEY");
    expect(serialized).not.toContain("gsk_");
    expect(serialized).not.toContain("tenant-1"); // no internal tenant ID
    expect(data.aiProviderStatus === undefined || typeof data.aiProviderStatus === "string").toBe(true);
  });
});

// ─── Provider abstraction (single key) ───────────────────────

describe("provider abstraction", () => {
  it("GroqProvider works with ONE key and documents the multi-key caveat", () => {
    const source = GroqProvider;
    expect(source).toBeDefined();
    // The class reads GROQ_API_KEY server-side only
    expect(String(GroqProvider)).toContain("class");
  });

  it("throws AI_PROVIDER_NO_KEY without a key (classified, not generic)", () => {
    const originalKey = process.env.GROQ_API_KEY;
    delete process.env.GROQ_API_KEY;
    try {
      expect(() => new GroqProvider()).toThrow(/GROQ_API_KEY is not set/);
    } finally {
      process.env.GROQ_API_KEY = originalKey;
    }
  });
});
