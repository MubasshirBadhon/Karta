import { describe, it, expect } from "vitest";
import { normalizeProduct, validateSyncRequest } from "@/lib/integrations/woocommerce/normalizer";

describe("WooCommerce Normalizer", () => {
  describe("normalizeProduct", () => {
    it("should normalize a simple product", () => {
      const wcProduct = {
        externalId: "123",
        sku: "TSHIRT-001",
        name: "Classic T-Shirt",
        slug: "classic-t-shirt",
        description: "A classic t-shirt",
        shortDescription: "Classic tee",
        price: 1500,
        regularPrice: 2000,
        salePrice: null,
        stockQuantity: 50,
        stockStatus: "instock",
        image: "https://example.com/image.jpg",
        type: "simple" as const,
        variations: [],
      };

      const result = normalizeProduct(wcProduct);

      expect(result.externalId).toBe("123");
      expect(result.sku).toBe("TSHIRT-001");
      expect(result.name).toBe("Classic T-Shirt");
      expect(result.slug).toBe("classic-t-shirt");
      expect(result.price).toBe(1500);
      expect(result.compareAtPrice).toBe(2000);
      expect(result.stock).toBe(50);
      expect(result.status).toBe("active");
      expect(result.type).toBe("simple");
    });

    it("should normalize a variable product with variations", () => {
      const wcProduct = {
        externalId: "456",
        sku: "TSHIRT-VAR",
        name: "Variable T-Shirt",
        slug: "variable-t-shirt",
        description: "A variable t-shirt",
        shortDescription: null,
        price: 0,
        regularPrice: 0,
        salePrice: null,
        stockQuantity: 0,
        stockStatus: "instock",
        image: "https://example.com/var-image.jpg",
        type: "variable" as const,
        variations: [
          {
            externalId: "457",
            sku: "TSHIRT-BLK-L",
            name: "Black / L",
            price: 1500,
            regularPrice: 2000,
            salePrice: null,
            stockQuantity: 20,
            stockStatus: "instock",
            image: "https://example.com/black-l.jpg",
            attributes: { color: "Black", size: "L" },
          },
          {
            externalId: "458",
            sku: "TSHIRT-WHT-M",
            name: "White / M",
            price: 1500,
            regularPrice: 2000,
            salePrice: null,
            stockQuantity: 15,
            stockStatus: "instock",
            image: "https://example.com/white-m.jpg",
            attributes: { color: "White", size: "M" },
          },
        ],
      };

      const result = normalizeProduct(wcProduct);

      expect(result.externalId).toBe("456");
      expect(result.type).toBe("variable");
      expect(result.price).toBe(1500); // Lowest variation price
      expect(result.stock).toBe(35); // Sum of variation stock
      expect(result.variations).toHaveLength(2);
      expect(result.variations[0].attributes).toEqual({ color: "Black", size: "L" });
      expect(result.variations[1].attributes).toEqual({ color: "White", size: "M" });
    });

    it("should generate slug from name if not provided", () => {
      const wcProduct = {
        externalId: "789",
        sku: null,
        name: "Cool Product Name",
        slug: "",
        description: null,
        shortDescription: null,
        price: 100,
        regularPrice: 0,
        salePrice: null,
        stockQuantity: 10,
        stockStatus: "instock",
        image: null,
        type: "simple" as const,
        variations: [],
      };

      const result = normalizeProduct(wcProduct);
      expect(result.slug).toBe("cool-product-name");
    });

    it("should handle missing optional fields", () => {
      const wcProduct = {
        externalId: "999",
        sku: null,
        name: "Minimal Product",
        slug: "minimal-product",
        description: null,
        shortDescription: null,
        price: 500,
        regularPrice: 0,
        salePrice: null,
        stockQuantity: 0,
        stockStatus: "outofstock",
        image: null,
        type: "simple" as const,
        variations: [],
      };

      const result = normalizeProduct(wcProduct);

      expect(result.sku).toBeNull();
      expect(result.description).toBeNull();
      expect(result.compareAtPrice).toBeNull();
      expect(result.image).toBeNull();
      expect(result.stock).toBe(0);
    });
  });

  describe("validateSyncRequest", () => {
    it("should validate a correct sync request", () => {
      const body = {
        products: [
          {
            externalId: "123",
            sku: "TEST-001",
            name: "Test Product",
            price: 100,
            type: "simple",
            variations: [],
          },
        ],
      };

      const result = validateSyncRequest(body);
      expect(result.success).toBe(true);
      expect(result.products).toHaveLength(1);
    });

    it("should reject empty products array", () => {
      const result = validateSyncRequest({ products: [] });
      expect(result.success).toBe(false);
      expect(result.errors).toBeDefined();
    });

    it("should reject missing required fields", () => {
      const result = validateSyncRequest({
        products: [{ externalId: "123" }],
      });
      expect(result.success).toBe(false);
    });

    it("should reject too many products", () => {
      const products = Array.from({ length: 101 }, (_, i) => ({
        externalId: String(i),
        name: `Product ${i}`,
        price: 100,
        type: "simple" as const,
        variations: [],
      }));

      const result = validateSyncRequest({ products });
      expect(result.success).toBe(false);
    });

    it("should reject invalid price", () => {
      const result = validateSyncRequest({
        products: [
          {
            externalId: "123",
            name: "Test",
            price: -100,
            type: "simple",
            variations: [],
          },
        ],
      });
      expect(result.success).toBe(false);
    });
  });
});
