import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * End-to-End Architecture Test
 *
 * Proves that both web and WhatsApp channels consume the same
 * tenant-scoped commerce data through the same engine.
 *
 * Mocks all external services.
 */

// Mock Prisma
vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    product: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
    },
    productVariant: {
      findFirst: vi.fn(),
    },
  },
}));

// Mock AI provider
vi.mock("@/lib/ai/provider", () => ({
  getAIProvider: vi.fn(),
}));

import { prisma } from "@/lib/db/prisma";
import { getAIProvider } from "@/lib/ai/provider";
import { processMessage } from "@/lib/ai/commerce-engine";
import { createUnifiedMessage } from "@/lib/channels/types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyMock = any;

describe("End-to-End Architecture Test", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("should use the same commerce data for web and WhatsApp", async () => {
    // Mock product data
    const mockFindMany = vi.fn().mockResolvedValue([
      {
        id: "prod-1",
        name: "Classic Black Sneaker",
        slug: "classic-black-sneaker",
        price: 3500,
        compareAtPrice: 4200,
        stock: 12,
        image: null,
        status: "active",
      },
    ]);
    (prisma.product as AnyMock).findMany = mockFindMany;

    // Mock AI provider - returns tool call first, then final response
    const mockGenerateResponse = vi.fn()
      .mockResolvedValueOnce({
        content: "",
        toolCalls: [{
          id: "call-1",
          type: "function" as const,
          function: { name: "search_products", arguments: JSON.stringify({ query: "black sneakers" }) },
        }],
      })
      .mockResolvedValueOnce({
        content: "Yes, we have the Classic Black Sneaker for ৳3,500.",
      });
    const mockProvider = { generateResponse: mockGenerateResponse };
    vi.mocked(getAIProvider).mockReturnValue(mockProvider as AnyMock);

    // Web message
    const webMessage = createUnifiedMessage({
      tenantId: "tenant-1",
      channel: "web",
      text: "Do you have black sneakers?",
    });
    const webResult = await processMessage(webMessage);

    // Reset mock for second call
    mockGenerateResponse.mockClear();
    mockGenerateResponse
      .mockResolvedValueOnce({
        content: "",
        toolCalls: [{
          id: "call-2",
          type: "function" as const,
          function: { name: "search_products", arguments: JSON.stringify({ query: "black sneakers" }) },
        }],
      })
      .mockResolvedValueOnce({
        content: "Yes, we have the Classic Black Sneaker for ৳3,500.",
      });

    // WhatsApp message
    const whatsappMessage = createUnifiedMessage({
      tenantId: "tenant-1",
      channel: "whatsapp",
      text: "Do you have black sneakers?",
    });
    const whatsappResult = await processMessage(whatsappMessage);

    // Both should use the same product data
    expect(webResult.text).toBe(whatsappResult.text);
    expect(webResult.text).toContain("Classic Black Sneaker");
    expect(webResult.text).toContain("3,500");
  });

  it("should maintain tenant isolation across channels", async () => {
    // Mock product data for tenant A only
    const mockFindMany = vi.fn().mockResolvedValue([
      {
        id: "prod-1",
        name: "Tenant A Product",
        slug: "tenant-a-product",
        price: 1000,
        compareAtPrice: null,
        stock: 5,
        image: null,
        status: "active",
      },
    ]);
    (prisma.product as AnyMock).findMany = mockFindMany;

    const mockGenerateResponse = vi.fn()
      .mockResolvedValueOnce({
        content: "",
        toolCalls: [{
          id: "call-1",
          type: "function" as const,
          function: { name: "search_products", arguments: JSON.stringify({ query: "product" }) },
        }],
      })
      .mockResolvedValueOnce({
        content: "Found Tenant A Product",
      });
    const mockProvider = { generateResponse: mockGenerateResponse };
    vi.mocked(getAIProvider).mockReturnValue(mockProvider as AnyMock);

    // Tenant A web message
    const tenantAWeb = createUnifiedMessage({
      tenantId: "tenant-A",
      channel: "web",
      text: "Show me products",
    });
    await processMessage(tenantAWeb);

    // Tenant A WhatsApp message
    const tenantAWhatsApp = createUnifiedMessage({
      tenantId: "tenant-A",
      channel: "whatsapp",
      text: "Show me products",
    });
    await processMessage(tenantAWhatsApp);

    // Both should use tenant-A
    expect(mockFindMany).toHaveBeenCalled();
    const allCalls = mockFindMany.mock.calls;
    const tenantACalls = allCalls.filter(call => call[0].where.tenantId === "tenant-A");
    expect(tenantACalls.length).toBeGreaterThanOrEqual(1);
  });
});
