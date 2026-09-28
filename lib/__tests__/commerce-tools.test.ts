import { describe, it, expect, vi, beforeEach } from "vitest";
import { commerceTools, getToolDefinitions, executeTool } from "@/lib/ai/commerce-tools";

// Mock the commerce service
vi.mock("@/lib/commerce/service", () => ({
  searchProducts: vi.fn(),
  getProduct: vi.fn(),
  getVariant: vi.fn(),
  checkStock: vi.fn(),
}));

import { searchProducts, getProduct, getVariant, checkStock } from "@/lib/commerce/service";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyMock = any;

describe("Commerce Tools", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("tool definitions", () => {
    it("should have 4 registered tools", () => {
      expect(commerceTools).toHaveLength(4);
    });

    it("should have correct tool names", () => {
      const names = commerceTools.map((t) => t.name);
      expect(names).toContain("search_products");
      expect(names).toContain("get_product");
      expect(names).toContain("get_variant");
      expect(names).toContain("check_stock");
    });

    it("should generate valid tool definitions for Groq", () => {
      const defs = getToolDefinitions();
      expect(defs).toHaveLength(4);
      defs.forEach((def) => {
        expect(def.type).toBe("function");
        expect(def.function.name).toBeDefined();
        expect(def.function.description).toBeDefined();
        expect(def.function.parameters).toBeDefined();
      });
    });
  });

  describe("search_products", () => {
    it("should call searchProducts with correct arguments", async () => {
      vi.mocked(searchProducts).mockResolvedValue([
        { id: "p1", name: "Test", slug: "test", price: 100, compareAtPrice: null, stock: 5, image: null, status: "active" },
      ]);

      const result = await executeTool("tenant-1", "search_products", {
        query: "test",
        maxPrice: 5000,
      });

      expect(searchProducts).toHaveBeenCalledWith("tenant-1", "test", {
        maxPrice: 5000,
        limit: 10,
      });
      expect(result).toHaveLength(1);
    });

    it("should reject invalid input", async () => {
      await expect(
        executeTool("tenant-1", "search_products", { limit: -1 })
      ).rejects.toThrow();
    });
  });

  describe("get_product", () => {
    it("should call getProduct with correct arguments", async () => {
      vi.mocked(getProduct).mockResolvedValue({
        id: "p1",
        name: "Test Product",
        slug: "test-product",
        description: "A test",
        price: 100,
        compareAtPrice: null,
        stock: 5,
        image: null,
        status: "active",
        variants: [],
      });

      const result = await executeTool("tenant-1", "get_product", {
        productId: "p1",
      });

      expect(getProduct).toHaveBeenCalledWith("tenant-1", "p1");
      expect(result).toHaveProperty("name", "Test Product");
    });

    it("should reject missing productId", async () => {
      await expect(
        executeTool("tenant-1", "get_product", {})
      ).rejects.toThrow();
    });
  });

  describe("get_variant", () => {
    it("should get variant by ID", async () => {
      vi.mocked(getVariant).mockResolvedValue({
        id: "v1",
        name: "Black / L",
        attributes: { color: "Black", size: "L" },
        price: 1500,
        stock: 10,
        sku: "TEST-BLK-L",
      });

      const result = await executeTool("tenant-1", "get_variant", {
        productId: "p1",
        variantId: "v1",
      });

      expect(getVariant).toHaveBeenCalledWith("tenant-1", "v1");
      expect(result).toHaveProperty("attributes");
    });

    it("should find variant by attributes", async () => {
      vi.mocked(getProduct).mockResolvedValue({
        id: "p1",
        name: "Test",
        slug: "test",
        description: null,
        price: 100,
        compareAtPrice: null,
        stock: 10,
        image: null,
        status: "active",
        variants: [
          { id: "v1", name: "Black / L", attributes: { color: "Black", size: "L" }, price: 1500, stock: 10, sku: "TEST-BLK-L" },
          { id: "v2", name: "White / M", attributes: { color: "White", size: "M" }, price: 1500, stock: 5, sku: "TEST-WHT-M" },
        ],
      });

      const result = await executeTool("tenant-1", "get_variant", {
        productId: "p1",
        attributes: { color: "Black", size: "L" },
      });

      expect(result).toHaveLength(1);
      expect((result as AnyMock[])[0].attributes).toEqual({ color: "Black", size: "L" });
    });
  });

  describe("check_stock", () => {
    it("should call checkStock with correct arguments", async () => {
      vi.mocked(checkStock).mockResolvedValue({
        productId: "p1",
        stock: 10,
        available: true,
      });

      const result = await executeTool("tenant-1", "check_stock", {
        productId: "p1",
      });

      expect(checkStock).toHaveBeenCalledWith("tenant-1", "p1", undefined);
      expect(result).toHaveProperty("available", true);
    });

    it("should check variant stock when variantId provided", async () => {
      vi.mocked(checkStock).mockResolvedValue({
        productId: "p1",
        variantId: "v1",
        stock: 5,
        available: true,
      });

      await executeTool("tenant-1", "check_stock", {
        productId: "p1",
        variantId: "v1",
      });

      expect(checkStock).toHaveBeenCalledWith("tenant-1", "p1", "v1");
    });
  });

  describe("security", () => {
    it("should reject unknown tool names", async () => {
      await expect(
        executeTool("tenant-1", "delete_product", {})
      ).rejects.toThrow("Unknown tool");
    });

    it("should reject arbitrary tool names from model output", async () => {
      await expect(
        executeTool("tenant-1", "exec_sql", { query: "DROP TABLE users" })
      ).rejects.toThrow("Unknown tool");
    });
  });
});
