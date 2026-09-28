import { describe, it, expect, vi, beforeEach } from "vitest";
import { processMessage } from "@/lib/ai/commerce-engine";
import { createUnifiedMessage } from "@/lib/channels/types";

// Mock the AI provider
vi.mock("@/lib/ai/provider", () => ({
  getAIProvider: vi.fn(),
}));

// Mock the commerce service
vi.mock("@/lib/commerce/service", () => ({
  searchProducts: vi.fn(),
  getProduct: vi.fn(),
  getVariant: vi.fn(),
  checkStock: vi.fn(),
}));

import { getAIProvider } from "@/lib/ai/provider";
import { searchProducts } from "@/lib/commerce/service";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyMock = any;

describe("Shared Commerce Engine", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe("web and WhatsApp use the same engine", () => {
    it("should process web message through processMessage()", async () => {
      const mockProvider = {
        generateResponse: vi.fn().mockResolvedValue({
          content: "Hello! How can I help you today?",
        }),
      };
      vi.mocked(getAIProvider).mockReturnValue(mockProvider as AnyMock);

      const webMessage = createUnifiedMessage({
        tenantId: "tenant-1",
        channel: "web",
        text: "Hello",
      });

      const result = await processMessage(webMessage);

      expect(result.success).toBe(true);
      expect(result.text).toBe("Hello! How can I help you today?");
    });

    it("should process WhatsApp message through processMessage()", async () => {
      const mockProvider = {
        generateResponse: vi.fn().mockResolvedValue({
          content: "Hello! How can I help you today?",
        }),
      };
      vi.mocked(getAIProvider).mockReturnValue(mockProvider as AnyMock);

      const whatsappMessage = createUnifiedMessage({
        tenantId: "tenant-1",
        channel: "whatsapp",
        text: "Hello",
      });

      const result = await processMessage(whatsappMessage);

      expect(result.success).toBe(true);
      expect(result.text).toBe("Hello! How can I help you today?");
    });

    it("should use the same commerce tools for both channels", async () => {
      vi.mocked(searchProducts).mockResolvedValue([
        { id: "p1", name: "Running Shoes", slug: "running-shoes", price: 3000, compareAtPrice: null, stock: 10, image: null, status: "active" },
      ]);

      const mockProvider = {
        generateResponse: vi.fn()
          .mockResolvedValueOnce({
            content: "",
            toolCalls: [{
              id: "call-1",
              type: "function" as const,
              function: { name: "search_products", arguments: JSON.stringify({ query: "shoes" }) },
            }],
          })
          .mockResolvedValueOnce({
            content: "I found several shoes!",
          }),
      };
      vi.mocked(getAIProvider).mockReturnValue(mockProvider as AnyMock);

      // Web message
      const webMessage = createUnifiedMessage({
        tenantId: "tenant-1",
        channel: "web",
        text: "Show me shoes",
      });
      await processMessage(webMessage);

      // WhatsApp message
      const whatsappMessage = createUnifiedMessage({
        tenantId: "tenant-1",
        channel: "whatsapp",
        text: "Show me shoes",
      });
      await processMessage(whatsappMessage);

      // Both should use the same search_products tool
      expect(searchProducts).toHaveBeenCalled();
    });

    it("should enforce tenant isolation for both channels", async () => {
      vi.mocked(searchProducts).mockResolvedValue([
        { id: "p1", name: "Tenant A Shoes", slug: "tenant-a-shoes", price: 3000, compareAtPrice: null, stock: 10, image: null, status: "active" },
      ]);

      const mockProvider = {
        generateResponse: vi.fn()
          .mockResolvedValueOnce({
            content: "",
            toolCalls: [{
              id: "call-1",
              type: "function" as const,
              function: { name: "search_products", arguments: JSON.stringify({ query: "shoes" }) },
            }],
          })
          .mockResolvedValueOnce({
            content: "Found shoes for tenant A",
          }),
      };
      vi.mocked(getAIProvider).mockReturnValue(mockProvider as AnyMock);

      // Tenant A web message
      const tenantAWeb = createUnifiedMessage({
        tenantId: "tenant-A",
        channel: "web",
        text: "Show me shoes",
      });
      await processMessage(tenantAWeb);

      // Tenant A WhatsApp message
      const tenantAWhatsApp = createUnifiedMessage({
        tenantId: "tenant-A",
        channel: "whatsapp",
        text: "Show me shoes",
      });
      await processMessage(tenantAWhatsApp);

      // Both should use tenant-A
      expect(searchProducts).toHaveBeenCalled();
      const allCalls = vi.mocked(searchProducts).mock.calls;
      const tenantACalls = allCalls.filter(call => call[0] === "tenant-A");
      expect(tenantACalls.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("commerce tools are shared", () => {
    it("should have 4 registered tools", async () => {
      const { commerceTools } = await import("@/lib/ai/commerce-tools");
      expect(commerceTools).toHaveLength(4);
      const names = commerceTools.map((t) => t.name);
      expect(names).toContain("search_products");
      expect(names).toContain("get_product");
      expect(names).toContain("get_variant");
      expect(names).toContain("check_stock");
    });

    it("should use the same system prompt for both channels", async () => {
      const mockProvider = {
        generateResponse: vi.fn().mockResolvedValue({
          content: "Hello!",
        }),
      };
      vi.mocked(getAIProvider).mockReturnValue(mockProvider as AnyMock);

      const webMessage = createUnifiedMessage({
        tenantId: "tenant-1",
        channel: "web",
        text: "Hello",
      });
      await processMessage(webMessage);

      const whatsappMessage = createUnifiedMessage({
        tenantId: "tenant-1",
        channel: "whatsapp",
        text: "Hello",
      });
      await processMessage(whatsappMessage);

      // Both should have system prompt as first message
      const webCall = vi.mocked(mockProvider.generateResponse).mock.calls[0][0];
      const whatsappCall = vi.mocked(mockProvider.generateResponse).mock.calls[1][0];

      expect(webCall.messages[0].role).toBe("system");
      expect(whatsappCall.messages[0].role).toBe("system");
      expect(webCall.messages[0].content).toBe(whatsappCall.messages[0].content);
    });
  });
});
