import { describe, it, expect, beforeEach, vi } from "vitest";
import { normalizeProduct, validateSyncRequest } from "@/lib/integrations/woocommerce/normalizer";
import { checkStock } from "@/lib/commerce/service";

// Mock the Prisma module
vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    product: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
    productVariant: {
      findFirst: vi.fn(),
    },
  },
}));

import { prisma } from "@/lib/db/prisma";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyMock = any;

describe("Stock Sync", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("normalizeProduct - stock handling", () => {
    it("should preserve null stockQuantity when manageStock is false", () => {
      const wcProduct = {
        externalId: "123",
        sku: "TEST-001",
        name: "Test Product",
        slug: "test-product",
        description: "A test product",
        shortDescription: null,
        price: 100,
        regularPrice: 120,
        salePrice: null,
        stockQuantity: null,
        stockStatus: "instock",
        manageStock: false,
        image: null,
        type: "simple" as const,
        variations: [],
      };

      const result = normalizeProduct(wcProduct);

      expect(result.stock).toBeNull();
    });

    it("should preserve positive stockQuantity when manageStock is true", () => {
      const wcProduct = {
        externalId: "123",
        sku: "TEST-001",
        name: "Test Product",
        slug: "test-product",
        description: "A test product",
        shortDescription: null,
        price: 100,
        regularPrice: 120,
        salePrice: null,
        stockQuantity: 50,
        stockStatus: "instock",
        manageStock: true,
        image: null,
        type: "simple" as const,
        variations: [],
      };

      const result = normalizeProduct(wcProduct);

      expect(result.stock).toBe(50);
    });

    it("should preserve zero stockQuantity", () => {
      const wcProduct = {
        externalId: "123",
        sku: "TEST-001",
        name: "Test Product",
        slug: "test-product",
        description: "A test product",
        shortDescription: null,
        price: 100,
        regularPrice: 120,
        salePrice: null,
        stockQuantity: 0,
        stockStatus: "outofstock",
        manageStock: true,
        image: null,
        type: "simple" as const,
        variations: [],
      };

      const result = normalizeProduct(wcProduct);

      expect(result.stock).toBe(0);
    });

    it("should sum variation stock for variable products", () => {
      const wcProduct = {
        externalId: "456",
        sku: "VAR-001",
        name: "Variable Product",
        slug: "variable-product",
        description: "A variable product",
        shortDescription: null,
        price: 200,
        regularPrice: 250,
        salePrice: null,
        stockQuantity: null,
        stockStatus: "instock",
        manageStock: false,
        image: null,
        type: "variable" as const,
        variations: [
          {
            externalId: "456-1",
            sku: "VAR-001-RED",
            name: "Red",
            price: 200,
            regularPrice: 250,
            salePrice: null,
            stockQuantity: 10,
            stockStatus: "instock",
            manageStock: true,
            image: null,
            attributes: { color: "Red" },
          },
          {
            externalId: "456-2",
            sku: "VAR-001-BLUE",
            name: "Blue",
            price: 200,
            regularPrice: 250,
            salePrice: null,
            stockQuantity: 20,
            stockStatus: "instock",
            manageStock: true,
            image: null,
            attributes: { color: "Blue" },
          },
        ],
      };

      const result = normalizeProduct(wcProduct);

      expect(result.stock).toBe(30); // 10 + 20
    });

    it("should handle variable product with null variation stock", () => {
      const wcProduct = {
        externalId: "456",
        sku: "VAR-001",
        name: "Variable Product",
        slug: "variable-product",
        description: "A variable product",
        shortDescription: null,
        price: 200,
        regularPrice: 250,
        salePrice: null,
        stockQuantity: null,
        stockStatus: "instock",
        manageStock: false,
        image: null,
        type: "variable" as const,
        variations: [
          {
            externalId: "456-1",
            sku: "VAR-001-RED",
            name: "Red",
            price: 200,
            regularPrice: 250,
            salePrice: null,
            stockQuantity: null,
            stockStatus: "instock",
            manageStock: false,
            image: null,
            attributes: { color: "Red" },
          },
        ],
      };

      const result = normalizeProduct(wcProduct);

      expect(result.stock).toBeNull();
    });
  });

  describe("checkStock - stock handling", () => {
    it("should return available=true for null stock with active status", async () => {
      vi.mocked(prisma.product.findFirst).mockResolvedValue({
        id: "prod-1",
        tenantId: "tenant-1",
        name: "Test Product",
        slug: "test-product",
        description: null,
        price: 100,
        compareAtPrice: null,
        stock: null,
        image: null,
        status: "active",
        externalId: "123",
        sku: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        variants: [],
      } as AnyMock);

      const result = await checkStock("tenant-1", "prod-1");

      expect(result.stock).toBeNull();
      expect(result.available).toBe(true);
    });

    it("should return available=true for positive stock", async () => {
      vi.mocked(prisma.product.findFirst).mockResolvedValue({
        id: "prod-1",
        tenantId: "tenant-1",
        name: "Test Product",
        slug: "test-product",
        description: null,
        price: 100,
        compareAtPrice: null,
        stock: 50,
        image: null,
        status: "active",
        externalId: "123",
        sku: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        variants: [],
      } as AnyMock);

      const result = await checkStock("tenant-1", "prod-1");

      expect(result.stock).toBe(50);
      expect(result.available).toBe(true);
    });

    it("should return available=false for zero stock", async () => {
      vi.mocked(prisma.product.findFirst).mockResolvedValue({
        id: "prod-1",
        tenantId: "tenant-1",
        name: "Test Product",
        slug: "test-product",
        description: null,
        price: 100,
        compareAtPrice: null,
        stock: 0,
        image: null,
        status: "active",
        externalId: "123",
        sku: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        variants: [],
      } as AnyMock);

      const result = await checkStock("tenant-1", "prod-1");

      expect(result.stock).toBe(0);
      expect(result.available).toBe(false);
    });

    it("should return available=false for null stock with inactive status", async () => {
      vi.mocked(prisma.product.findFirst).mockResolvedValue({
        id: "prod-1",
        tenantId: "tenant-1",
        name: "Test Product",
        slug: "test-product",
        description: null,
        price: 100,
        compareAtPrice: null,
        stock: null,
        image: null,
        status: "draft",
        externalId: "123",
        sku: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        variants: [],
      } as AnyMock);

      const result = await checkStock("tenant-1", "prod-1");

      expect(result.stock).toBeNull();
      expect(result.available).toBe(false);
    });

    it("should sum variant stock for variable products", async () => {
      vi.mocked(prisma.product.findFirst).mockResolvedValue({
        id: "prod-1",
        tenantId: "tenant-1",
        name: "Variable Product",
        slug: "variable-product",
        description: null,
        price: 200,
        compareAtPrice: null,
        stock: null,
        image: null,
        status: "active",
        externalId: "456",
        sku: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        variants: [
          {
            id: "var-1",
            productId: "prod-1",
            externalId: "456-1",
            sku: "VAR-001-RED",
            name: "Red",
            attributes: { color: "Red" },
            price: 200,
            stock: 10,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
          {
            id: "var-2",
            productId: "prod-1",
            externalId: "456-2",
            sku: "VAR-001-BLUE",
            name: "Blue",
            attributes: { color: "Blue" },
            price: 200,
            stock: 20,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ],
      } as AnyMock);

      const result = await checkStock("tenant-1", "prod-1");

      expect(result.stock).toBe(30);
      expect(result.available).toBe(true);
    });

    it("should handle variant with null stock", async () => {
      vi.mocked(prisma.productVariant.findFirst).mockResolvedValue({
        id: "var-1",
        productId: "prod-1",
        externalId: "456-1",
        sku: "VAR-001-RED",
        name: "Red",
        attributes: { color: "Red" },
        price: 200,
        stock: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as AnyMock);

      vi.mocked(prisma.product.findFirst).mockResolvedValue({
        id: "prod-1",
        tenantId: "tenant-1",
        name: "Variable Product",
        slug: "variable-product",
        description: null,
        price: 200,
        compareAtPrice: null,
        stock: null,
        image: null,
        status: "active",
        externalId: "456",
        sku: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as AnyMock);

      const result = await checkStock("tenant-1", "prod-1", "var-1");

      expect(result.stock).toBeNull();
      expect(result.available).toBe(true);
    });
  });

  describe("validateSyncRequest - stock validation", () => {
    it("should accept null stockQuantity", () => {
      const body = {
        products: [
          {
            externalId: "123",
            sku: "TEST-001",
            name: "Test Product",
            price: 100,
            stockQuantity: null,
            stockStatus: "instock",
            manageStock: false,
            type: "simple",
          },
        ],
      };

      const result = validateSyncRequest(body);

      expect(result.success).toBe(true);
      expect(result.products?.[0].stock).toBeNull();
    });

    it("should accept positive stockQuantity", () => {
      const body = {
        products: [
          {
            externalId: "123",
            sku: "TEST-001",
            name: "Test Product",
            price: 100,
            stockQuantity: 50,
            stockStatus: "instock",
            manageStock: true,
            type: "simple",
          },
        ],
      };

      const result = validateSyncRequest(body);

      expect(result.success).toBe(true);
      expect(result.products?.[0].stock).toBe(50);
    });

    it("should accept zero stockQuantity", () => {
      const body = {
        products: [
          {
            externalId: "123",
            sku: "TEST-001",
            name: "Test Product",
            price: 100,
            stockQuantity: 0,
            stockStatus: "outofstock",
            manageStock: true,
            type: "simple",
          },
        ],
      };

      const result = validateSyncRequest(body);

      expect(result.success).toBe(true);
      expect(result.products?.[0].stock).toBe(0);
    });
  });
});
