import { describe, it, expect, beforeEach, vi } from "vitest";
import { syncProducts, softDeleteProduct } from "@/lib/integrations/woocommerce/sync";
import type { NormalizedProduct } from "@/lib/integrations/woocommerce/normalizer";

// Mock the Prisma module
vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    product: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      findFirst: vi.fn(),
    },
    productVariant: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
}));

import { prisma } from "@/lib/db/prisma";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyMock = any;

describe("WooCommerce Sync", () => {
  const mockProduct: NormalizedProduct = {
    externalId: "123",
    sku: "TEST-001",
    name: "Test Product",
    slug: "test-product",
    description: "A test product",
    price: 100,
    compareAtPrice: null,
    stock: 10,
    image: null,
    images: null,
    category: null,
    productUrl: null,
    stockStatus: null,
    status: "active",
    type: "simple",
    variations: [],
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("syncProducts", () => {
    it("should create a new product when it does not exist", async () => {
      vi.mocked(prisma.product.findUnique).mockResolvedValue(null);
      vi.mocked(prisma.product.create).mockResolvedValue({
        id: "prod-1",
        tenantId: "tenant-1",
        externalId: "123",
        sku: "TEST-001",
        name: "Test Product",
        slug: "test-product",
        description: "A test product",
        price: 100,
        compareAtPrice: null,
        stock: 10,
        image: null,
        status: "active",
        createdAt: new Date(),
        updatedAt: new Date(),
      } as AnyMock);
      vi.mocked(prisma.product.findFirst).mockResolvedValue({
        id: "prod-1",
        createdAt: new Date(), // Just created
      } as AnyMock);

      const result = await syncProducts("tenant-1", [mockProduct]);

      expect(result.created).toBe(1);
      expect(result.updated).toBe(0);
      expect(result.failed).toBe(0);
      expect(prisma.product.create).toHaveBeenCalled();
    });

    it("should update an existing product", async () => {
      const existingProduct = {
        id: "prod-1",
        tenantId: "tenant-1",
        externalId: "123",
        sku: "TEST-001",
        name: "Old Name",
        slug: "old-name",
        description: "Old description",
        price: 50,
        compareAtPrice: null,
        stock: 5,
        image: null,
        status: "active",
        createdAt: new Date(Date.now() - 86400000), // Created yesterday
        updatedAt: new Date(),
        variants: [],
      };

      vi.mocked(prisma.product.findUnique).mockResolvedValue(existingProduct as AnyMock);
      vi.mocked(prisma.product.update).mockResolvedValue({ ...existingProduct, name: "Test Product" } as AnyMock);
      vi.mocked(prisma.product.findFirst).mockResolvedValue({
        id: "prod-1",
        createdAt: new Date(Date.now() - 86400000),
      } as AnyMock);

      const result = await syncProducts("tenant-1", [mockProduct]);

      expect(result.created).toBe(0);
      expect(result.updated).toBe(1);
      expect(result.failed).toBe(0);
      expect(prisma.product.update).toHaveBeenCalled();
    });

    it("should handle sync failures gracefully", async () => {
      vi.mocked(prisma.product.findUnique).mockRejectedValue(new Error("DB error"));

      const result = await syncProducts("tenant-1", [mockProduct]);

      expect(result.failed).toBe(1);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain("DB error");
    });

    it("should sync variants for variable products", async () => {
      const variableProduct: NormalizedProduct = {
        ...mockProduct,
        externalId: "456",
        type: "variable",
        variations: [
          {
            externalId: "457",
            sku: "VAR-001",
            name: "Black / L",
            price: 1500,
            stock: 20,
            attributes: { color: "Black", size: "L" },
          },
        ],
      };

      vi.mocked(prisma.product.findUnique).mockResolvedValue(null);
      vi.mocked(prisma.product.create).mockResolvedValue({
        id: "prod-2",
        tenantId: "tenant-1",
        externalId: "456",
        sku: null,
        name: "Variable Product",
        slug: "variable-product",
        description: null,
        price: 1500,
        compareAtPrice: null,
        stock: 20,
        image: null,
        status: "active",
        createdAt: new Date(),
        updatedAt: new Date(),
      } as AnyMock);
      vi.mocked(prisma.product.findFirst).mockResolvedValue({
        id: "prod-2",
        createdAt: new Date(),
      } as AnyMock);

      const result = await syncProducts("tenant-1", [variableProduct]);

      expect(result.created).toBe(1);
      expect(prisma.productVariant.create).toHaveBeenCalled();
    });
  });

  describe("softDeleteProduct", () => {
    it("should mark product as archived", async () => {
      vi.mocked(prisma.product.findUnique).mockResolvedValue({
        id: "prod-1",
        tenantId: "tenant-1",
        externalId: "123",
      } as AnyMock);
      vi.mocked(prisma.product.update).mockResolvedValue({} as AnyMock);

      const result = await softDeleteProduct("tenant-1", "123");

      expect(result).toBe(true);
      expect(prisma.product.update).toHaveBeenCalledWith({
        where: { id: "prod-1" },
        data: { status: "archived" },
      });
    });

    it("should return false for non-existent product", async () => {
      vi.mocked(prisma.product.findUnique).mockResolvedValue(null);

      const result = await softDeleteProduct("tenant-1", "999");

      expect(result).toBe(false);
    });

    it("should not delete products from other tenants", async () => {
      vi.mocked(prisma.product.findUnique).mockResolvedValue(null);

      const result = await softDeleteProduct("tenant-2", "123");

      expect(result).toBe(false);
      expect(prisma.product.update).not.toHaveBeenCalled();
    });
  });
});
