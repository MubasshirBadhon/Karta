import { describe, it, expect, beforeEach, vi } from "vitest";
import { syncProducts, softDeleteProduct, reconcileProducts } from "@/lib/integrations/woocommerce/sync";
import { getProduct, checkStock } from "@/lib/commerce/service";
import type { NormalizedProduct } from "@/lib/integrations/woocommerce/normalizer";
import { POST as SYNC_POST } from "@/app/api/integrations/woocommerce/products/sync/route";
import { DELETE as DISCONNECT_DELETE } from "@/app/api/integrations/woocommerce/connections/[connectionId]/route";
import { generateAuthHeaders } from "@/lib/integrations/woocommerce/auth";

// Mock the Prisma module
vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    product: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      findFirst: vi.fn(),
      updateMany: vi.fn(),
    },
    productVariant: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      deleteMany: vi.fn(),
    },
    wooCommerceConnection: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    tenant: {
      findUnique: vi.fn(),
      create: vi.fn(),
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
    manageStock: null,
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

      const result = await syncProducts("tenant-1", "conn-1", [mockProduct]);

      expect(result.created).toBe(1);
      expect(result.updated).toBe(0);
      expect(result.failed).toBe(0);
      expect(prisma.product.create).toHaveBeenCalled();
      // Identity is scoped to the Woo connection
      expect(prisma.product.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            tenantId_wooConnectionId_externalId: {
              tenantId: "tenant-1",
              wooConnectionId: "conn-1",
              externalId: "123",
            },
          },
        })
      );
      // New rows are created with the connection scope
      expect(prisma.product.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ wooConnectionId: "conn-1" }),
        })
      );
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

      const result = await syncProducts("tenant-1", "conn-1", [mockProduct]);

      expect(result.created).toBe(0);
      expect(result.updated).toBe(1);
      expect(result.failed).toBe(0);
      expect(prisma.product.update).toHaveBeenCalled();
    });

    it("should handle sync failures gracefully", async () => {
      vi.mocked(prisma.product.findUnique).mockRejectedValue(new Error("DB error"));

      const result = await syncProducts("tenant-1", "conn-1", [mockProduct]);

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

      const result = await syncProducts("tenant-1", "conn-1", [variableProduct]);

      expect(result.created).toBe(1);
      expect(prisma.productVariant.create).toHaveBeenCalled();
    });
  });

  describe("softDeleteProduct", () => {
    it("should mark product as archived (scoped to the connection)", async () => {
      vi.mocked(prisma.product.findFirst).mockResolvedValue({
        id: "prod-1",
        tenantId: "tenant-1",
        externalId: "123",
        wooConnectionId: "conn-1",
      } as AnyMock);
      vi.mocked(prisma.product.update).mockResolvedValue({} as AnyMock);

      const result = await softDeleteProduct("tenant-1", "conn-1", "123");

      expect(result).toBe(true);
      expect(prisma.product.update).toHaveBeenCalledWith({
        where: { id: "prod-1" },
        data: { status: "archived" },
      });
      // The lookup is scoped: this connection + legacy rows only
      expect(prisma.product.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            tenantId: "tenant-1",
            externalId: "123",
            OR: [{ wooConnectionId: "conn-1" }, { wooConnectionId: null }],
          }),
        })
      );
    });

    it("should return false for non-existent product", async () => {
      vi.mocked(prisma.product.findFirst).mockResolvedValue(null);

      const result = await softDeleteProduct("tenant-1", "conn-1", "999");

      expect(result).toBe(false);
    });

    it("should not delete products from other tenants", async () => {
      vi.mocked(prisma.product.findFirst).mockResolvedValue(null);

      const result = await softDeleteProduct("tenant-2", "conn-1", "123");

      expect(result).toBe(false);
      expect(prisma.product.update).not.toHaveBeenCalled();
    });

    it("should not archive an already-archived product again", async () => {
      vi.mocked(prisma.product.findFirst).mockResolvedValue(null);

      const result = await softDeleteProduct("tenant-1", "conn-1", "123");

      expect(result).toBe(false);
      expect(prisma.product.update).not.toHaveBeenCalled();
    });
  });

  // ─── Full-sync reconciliation lifecycle ─────────────────────

  describe("reconcileProducts (full sync archive)", () => {
    it("full sync archives genuinely missing products (requirement e)", async () => {
      vi.mocked(prisma.product.updateMany).mockResolvedValue({ count: 3 } as AnyMock);

      // The completed sync saw externalId "123" only — everything else
      // previously active gets archived.
      const result = await reconcileProducts("tenant-1", "conn-1", ["123"]);

      expect(result.archived).toBe(3);
      expect(prisma.product.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            tenantId: "tenant-1",
            status: { not: "archived" },
            externalId: { notIn: ["123"] },
            OR: [{ wooConnectionId: "conn-1" }, { wooConnectionId: null }],
          }),
          data: { status: "archived" },
        })
      );
    });

    it("archive side also covers legacy rows with no connection scope", async () => {
      vi.mocked(prisma.product.updateMany).mockResolvedValue({ count: 1 } as AnyMock);

      await reconcileProducts("tenant-1", "conn-1", ["123"]);

      // OR: [{ wooConnectionId }, { wooConnectionId: null }] — legacy rows
      // (synced before connection-scoped identity) are archived too, so a
      // reconnect leaves no duplicate active catalog.
      const where = (vi.mocked(prisma.product.updateMany).mock.calls[0][0] as AnyMock).where;
      expect(where.OR).toEqual([{ wooConnectionId: "conn-1" }, { wooConnectionId: null }]);
    });

    it("products seen in the sync are never archived", async () => {
      vi.mocked(prisma.product.updateMany).mockResolvedValue({ count: 0 } as AnyMock);

      await reconcileProducts("tenant-1", "conn-1", ["123", "456", "789"]);

      expect(prisma.product.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            externalId: { notIn: ["123", "456", "789"] },
          }),
        })
      );
    });
  });

  // ─── Two Woo connections / reconnection (requirements h, j) ──

  describe("connection-scoped product identity", () => {
    it("two Woo connections can safely use the same external product ID (h)", async () => {
      // Connection A has an archived row for externalId 123; connection B
      // syncs the same external ID — a NEW row scoped to B is created.
      vi.mocked(prisma.product.findUnique).mockResolvedValue(null); // no (T, B, 123) row
      vi.mocked(prisma.product.create).mockResolvedValue({ id: "prod-new" } as AnyMock);

      const result = await syncProducts("tenant-1", "conn-B", [mockProduct]);

      expect(result.created).toBe(1);
      // The lookup was scoped to conn-B — it did NOT match conn-A's row
      expect(prisma.product.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            tenantId_wooConnectionId_externalId: {
              tenantId: "tenant-1",
              wooConnectionId: "conn-B",
              externalId: "123",
            },
          },
        })
      );
    });

    it("reconnecting does not resurrect unrelated archived products (j)", async () => {
      // Connection B's sync upserts (T, B, 123): findUnique is scoped to B
      // and never matches conn-A's archived row — no resurrection.
      vi.mocked(prisma.product.findUnique).mockResolvedValue(null);
      vi.mocked(prisma.product.create).mockResolvedValue({ id: "prod-new" } as AnyMock);

      await syncProducts("tenant-1", "conn-B", [mockProduct]);

      // The only write is a CREATE scoped to conn-B — no update to any
      // archived row from another connection
      expect(prisma.product.update).not.toHaveBeenCalled();
      expect(prisma.product.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ wooConnectionId: "conn-B", status: "active" }),
        })
      );
    });
  });

  // ─── Sync endpoint: batch gating + reconciliation (d, e) ────

  describe("sync endpoint reconciliation gating", () => {
    const authHeaders = generateAuthHeaders("conn-1", "secret");

    function makeSyncRequest(body: unknown): Request {
      return new Request("https://karta-ozla.onrender.com/api/integrations/woocommerce/products/sync", {
        method: "POST",
        headers: { "content-type": "application/json", ...authHeaders },
        body: JSON.stringify(body),
      });
    }

    function setupConnection() {
      vi.mocked(prisma.wooCommerceConnection.findUnique).mockResolvedValue({
        id: "conn-row-1",
        tenantId: "tenant-1",
        connectionId: "conn-1",
        connectionSecret: "secret",
        status: "active",
      } as AnyMock);
      vi.mocked(prisma.product.findUnique).mockResolvedValue(null);
      vi.mocked(prisma.product.create).mockResolvedValue({ id: "prod-1" } as AnyMock);
      vi.mocked(prisma.product.updateMany).mockResolvedValue({ count: 0 } as AnyMock);
    }

    beforeEach(() => {
      setupConnection();
    });

    it("partial sync failure does NOT archive missing products (d)", async () => {
      // Batch 1 of 2 (not final) — reconciliation must NOT run
      const res = await SYNC_POST(
        makeSyncRequest({
          products: [{ externalId: "123", name: "Test Product", price: 100, stockQuantity: 5, stockStatus: "instock", type: "simple", variations: [] }],
          sync: { isFinalBatch: false, seenExternalIds: ["123"] },
        })
      );
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.isFinalBatch).toBe(false);
      expect(data.archived).toBe(0);
      // No reconciliation query at all
      expect(prisma.product.updateMany).not.toHaveBeenCalled();
    });

    it("full sync (final batch) archives genuinely missing products (e)", async () => {
      vi.mocked(prisma.product.updateMany).mockResolvedValue({ count: 2 } as AnyMock);

      // Final batch: the completed sync saw only externalId 123
      const res = await SYNC_POST(
        makeSyncRequest({
          products: [{ externalId: "123", name: "Test Product", price: 100, stockQuantity: 5, stockStatus: "instock", type: "simple", variations: [] }],
          sync: { isFinalBatch: true, seenExternalIds: ["123"] },
        })
      );
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.isFinalBatch).toBe(true);
      expect(data.archived).toBe(2);
      expect(prisma.product.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            externalId: { notIn: ["123"] },
          }),
          data: { status: "archived" },
        })
      );
    });

    it("legacy plugin payloads (no batch metadata) only upsert — never archive", async () => {
      const res = await SYNC_POST(
        makeSyncRequest({
          products: [{ externalId: "123", name: "Test Product", price: 100, stockQuantity: 5, stockStatus: "instock", type: "simple", variations: [] }],
        })
      );
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.isFinalBatch).toBe(false);
      expect(data.archived).toBe(0);
      expect(prisma.product.updateMany).not.toHaveBeenCalled();
    });

    it("rejected authentication never syncs or archives", async () => {
      vi.mocked(prisma.wooCommerceConnection.findUnique).mockResolvedValue(null);

      const res = await SYNC_POST(
        makeSyncRequest({
          products: [{ externalId: "123", name: "Test Product", price: 100, stockQuantity: 5, stockStatus: "instock", type: "simple", variations: [] }],
          sync: { isFinalBatch: true, seenExternalIds: ["123"] },
        })
      );

      expect(res.status).toBe(401);
      expect(prisma.product.create).not.toHaveBeenCalled();
      expect(prisma.product.updateMany).not.toHaveBeenCalled();
    });
  });

  // ─── Disconnect lifecycle (requirement i) ────────────────────

  describe("disconnect archives products", () => {
    it("marks the connection inactive and archives products (no hard delete)", async () => {
      vi.mocked(prisma.tenant.findUnique).mockResolvedValue({
        id: "tenant-1",
        name: "Karta Demo Store",
        slug: "karta-demo-store",
      } as AnyMock);
      vi.mocked(prisma.wooCommerceConnection.findUnique).mockResolvedValue({
        id: "conn-row-1",
        tenantId: "tenant-1",
        connectionId: "conn-1",
        connectionSecret: "secret",
        status: "active",
      } as AnyMock);
      vi.mocked(prisma.wooCommerceConnection.update).mockResolvedValue({} as AnyMock);
      vi.mocked(prisma.product.updateMany).mockResolvedValue({ count: 21 } as AnyMock);

      const request = new Request("https://karta-ozla.onrender.com/api/integrations/woocommerce/connections/conn-1", {
        method: "DELETE",
      });
      const res = await DISCONNECT_DELETE(request, { params: Promise.resolve({ connectionId: "conn-1" }) });
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.success).toBe(true);
      // Soft disconnect — the connection record is preserved (revoked)
      expect(prisma.wooCommerceConnection.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "conn-row-1" },
          data: { status: "disconnected" },
        })
      );
      // Products archived (soft) — never hard-deleted
      expect(prisma.product.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ tenantId: "tenant-1", status: { not: "archived" } }),
          data: { status: "archived" },
        })
      );
    });

    it("returns 404 for an unknown connection", async () => {
      vi.mocked(prisma.tenant.findUnique).mockResolvedValue({
        id: "tenant-1",
        name: "Karta Demo Store",
        slug: "karta-demo-store",
      } as AnyMock);
      vi.mocked(prisma.wooCommerceConnection.findUnique).mockResolvedValue(null);

      const request = new Request("https://karta-ozla.onrender.com/api/integrations/woocommerce/connections/conn-x", {
        method: "DELETE",
      });
      const res = await DISCONNECT_DELETE(request, { params: Promise.resolve({ connectionId: "conn-x" }) });

      expect(res.status).toBe(404);
      expect(prisma.wooCommerceConnection.update).not.toHaveBeenCalled();
      expect(prisma.product.updateMany).not.toHaveBeenCalled();
    });
  });

  // ─── Archived products never returned to AI (requirements f, 11) ──

  describe("commerce service archived exclusion", () => {
    it("getProduct excludes archived products (never returned to AI)", async () => {
      vi.mocked(prisma.product.findFirst).mockResolvedValue(null);

      const result = await getProduct("tenant-1", "prod-1");

      expect(result).toBeNull();
      // The query filters status: "active"
      expect(prisma.product.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ status: "active" }),
        })
      );
    });

    it("checkStock marks archived products unavailable even with stock", async () => {
      vi.mocked(prisma.product.findFirst).mockResolvedValue({
        id: "prod-1",
        tenantId: "tenant-1",
        stock: 10,
        status: "archived",
        variants: [],
      } as AnyMock);

      const stock = await checkStock("tenant-1", "prod-1");

      expect(stock.available).toBe(false);
      expect(stock.stock).toBeNull();
    });
  });
});
