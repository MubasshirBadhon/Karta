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
import { searchProducts, getProduct, checkStock } from "@/lib/commerce/service";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyMock = any;

describe("AI Commerce Engine", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("processMessage", () => {
    it("should process a simple greeting without tool calls", async () => {
      const mockProvider = {
        generateResponse: vi.fn().mockResolvedValue({
          content: "Hello! How can I help you today?",
        }),
      };
      vi.mocked(getAIProvider).mockReturnValue(mockProvider as AnyMock);

      const message = createUnifiedMessage({
        tenantId: "tenant-1",
        channel: "web",
        text: "Hello",
      });

      const result = await processMessage(message);

      expect(result.success).toBe(true);
      expect(result.text).toBe("Hello! How can I help you today?");
      expect(result.toolCalls).toHaveLength(0);
    });

    it("should call search_products when customer asks about products", async () => {
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
            content: "I found several shoes for you!",
          }),
      };
      vi.mocked(getAIProvider).mockReturnValue(mockProvider as AnyMock);
      vi.mocked(searchProducts).mockResolvedValue([
        { id: "p1", name: "Running Shoes", slug: "running-shoes", price: 3000, compareAtPrice: null, stock: 10, image: null, status: "active" },
      ]);

      const message = createUnifiedMessage({
        tenantId: "tenant-1",
        channel: "web",
        text: "Show me shoes",
      });

      const result = await processMessage(message);

      expect(result.success).toBe(true);
      expect(result.text).toBe("I found several shoes for you!");
      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0].toolName).toBe("search_products");
      expect(searchProducts).toHaveBeenCalledWith("tenant-1", "shoes", expect.any(Object));
    });

    it("should call get_product when customer asks about a specific product", async () => {
      const mockProvider = {
        generateResponse: vi.fn()
          .mockResolvedValueOnce({
            content: "",
            toolCalls: [{
              id: "call-1",
              type: "function" as const,
              function: { name: "get_product", arguments: JSON.stringify({ productId: "p1" }) },
            }],
          })
          .mockResolvedValueOnce({
            content: "The Classic T-Shirt is ৳1,500.",
          }),
      };
      vi.mocked(getAIProvider).mockReturnValue(mockProvider as AnyMock);
      vi.mocked(getProduct).mockResolvedValue({
        id: "p1",
        name: "Classic T-Shirt",
        slug: "classic-t-shirt",
        description: "A classic tee",
        price: 1500,
        compareAtPrice: null,
        stock: 20,
        image: null,
        status: "active",
        variants: [],
      });

      const message = createUnifiedMessage({
        tenantId: "tenant-1",
        channel: "web",
        text: "How much is the Classic T-Shirt?",
      });

      const result = await processMessage(message);

      expect(result.success).toBe(true);
      expect(result.toolCalls[0].toolName).toBe("get_product");
      expect(getProduct).toHaveBeenCalledWith("tenant-1", "p1");
    });

    it("should call check_stock when customer asks about availability", async () => {
      const mockProvider = {
        generateResponse: vi.fn()
          .mockResolvedValueOnce({
            content: "",
            toolCalls: [{
              id: "call-1",
              type: "function" as const,
              function: { name: "check_stock", arguments: JSON.stringify({ productId: "p1" }) },
            }],
          })
          .mockResolvedValueOnce({
            content: "Yes, it's in stock! We have 10 available.",
          }),
      };
      vi.mocked(getAIProvider).mockReturnValue(mockProvider as AnyMock);
      vi.mocked(checkStock).mockResolvedValue({
        productId: "p1",
        stock: 10,
        available: true,
      });

      const message = createUnifiedMessage({
        tenantId: "tenant-1",
        channel: "web",
        text: "Is it in stock?",
      });

      const result = await processMessage(message);

      expect(result.success).toBe(true);
      expect(result.toolCalls[0].toolName).toBe("check_stock");
      expect(checkStock).toHaveBeenCalledWith("tenant-1", "p1", undefined);
    });

    it("should handle multiple sequential tool calls", async () => {
      const mockProvider = {
        generateResponse: vi.fn()
          .mockResolvedValueOnce({
            content: "",
            toolCalls: [{
              id: "call-1",
              type: "function" as const,
              function: { name: "search_products", arguments: JSON.stringify({ query: "shoes", maxPrice: 5000 }) },
            }],
          })
          .mockResolvedValueOnce({
            content: "",
            toolCalls: [{
              id: "call-2",
              type: "function" as const,
              function: { name: "check_stock", arguments: JSON.stringify({ productId: "p1" }) },
            }],
          })
          .mockResolvedValueOnce({
            content: "Yes, the Running Shoes are available in size 42 for ৳3,000.",
          }),
      };
      vi.mocked(getAIProvider).mockReturnValue(mockProvider as AnyMock);
      vi.mocked(searchProducts).mockResolvedValue([
        { id: "p1", name: "Running Shoes", slug: "running-shoes", price: 3000, compareAtPrice: null, stock: 10, image: null, status: "active" },
      ]);
      vi.mocked(checkStock).mockResolvedValue({
        productId: "p1",
        stock: 10,
        available: true,
      });

      const message = createUnifiedMessage({
        tenantId: "tenant-1",
        channel: "web",
        text: "Do you have shoes under 5000?",
      });

      const result = await processMessage(message);

      expect(result.success).toBe(true);
      expect(result.toolCalls).toHaveLength(2);
      expect(result.toolCalls[0].toolName).toBe("search_products");
      expect(result.toolCalls[1].toolName).toBe("check_stock");
    });

    it("should handle tool execution errors gracefully", async () => {
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
            content: "I couldn't find any shoes matching your search.",
          }),
      };
      vi.mocked(getAIProvider).mockReturnValue(mockProvider as AnyMock);
      vi.mocked(searchProducts).mockRejectedValue(new Error("Database error"));

      const message = createUnifiedMessage({
        tenantId: "tenant-1",
        channel: "web",
        text: "Show me shoes",
      });

      const result = await processMessage(message);

      expect(result.success).toBe(true);
      expect(result.toolCalls[0].result).toHaveProperty("error");
    });

    it("should enforce tool iteration limit", async () => {
      // Create a provider that always returns tool calls (infinite loop)
      const mockProvider = {
        generateResponse: vi.fn().mockResolvedValue({
          content: "",
          toolCalls: [{
            id: "call-1",
            type: "function" as const,
            function: { name: "search_products", arguments: JSON.stringify({ query: "test" }) },
          }],
        }),
      };
      vi.mocked(getAIProvider).mockReturnValue(mockProvider as AnyMock);
      vi.mocked(searchProducts).mockResolvedValue([]);

      const message = createUnifiedMessage({
        tenantId: "tenant-1",
        channel: "web",
        text: "test",
      });

      const result = await processMessage(message);

      // Should stop after MAX_TOOL_ITERATIONS
      expect(mockProvider.generateResponse).toHaveBeenCalledTimes(5);
      expect(result.text).toContain("trouble processing");
    });

    it("should handle provider errors gracefully", async () => {
      const mockProvider = {
        generateResponse: vi.fn().mockRejectedValue(new Error("Groq API error")),
      };
      vi.mocked(getAIProvider).mockReturnValue(mockProvider as AnyMock);

      const message = createUnifiedMessage({
        tenantId: "tenant-1",
        channel: "web",
        text: "Hello",
      });

      const result = await processMessage(message);

      expect(result.success).toBe(false);
      expect(result.text).toContain("technical difficulties");
    });

    it("should not invent product information", async () => {
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
            content: "I found several shoes for you!",
          }),
      };
      vi.mocked(getAIProvider).mockReturnValue(mockProvider as AnyMock);
      vi.mocked(searchProducts).mockResolvedValue([]);

      const message = createUnifiedMessage({
        tenantId: "tenant-1",
        channel: "web",
        text: "Show me shoes",
      });

      const result = await processMessage(message);

      // The AI should not claim to find products when search returns empty
      expect(result.toolCalls[0].result).toEqual([]);
    });
  });
});
