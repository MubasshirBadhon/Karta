import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock the tenant resolution module
vi.mock("@/lib/tenant/resolution", () => ({
  getOrCreateDemoTenant: vi.fn(),
}));

// Mock the Prisma module
vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    wooCommerceConnection: {
      findUnique: vi.fn(),
      delete: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
    },
    product: {
      findMany: vi.fn(),
      count: vi.fn(),
    },
    order: {
      findMany: vi.fn(),
      count: vi.fn(),
    },
    tenant: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      upsert: vi.fn(),
    },
  },
}));

import { prisma } from "@/lib/db/prisma";
import { getOrCreateDemoTenant } from "@/lib/tenant/resolution";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyMock = any;

describe("WooCommerce Connections", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("DELETE /api/integrations/woocommerce/connections/[connectionId]", () => {
    it("should delete an existing connection", async () => {
      const mockTenant = { id: "tenant-1", name: "Test Tenant", slug: "test-tenant" };
      const mockConnection = {
        id: "conn-1",
        connectionId: "kwc_abc123",
        tenantId: "tenant-1",
        siteUrl: "https://example.com",
        status: "active",
      };

      vi.mocked(getOrCreateDemoTenant).mockResolvedValue(mockTenant as AnyMock);
      vi.mocked(prisma.wooCommerceConnection.findUnique).mockResolvedValue(mockConnection as AnyMock);
      vi.mocked(prisma.wooCommerceConnection.delete).mockResolvedValue(mockConnection as AnyMock);

      const { DELETE } = await import("@/app/api/integrations/woocommerce/connections/[connectionId]/route");
      const request = new Request("http://localhost:3000/api/integrations/woocommerce/connections/kwc_abc123", {
        method: "DELETE",
      });
      const response = await DELETE(request, { params: Promise.resolve({ connectionId: "kwc_abc123" }) });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(prisma.wooCommerceConnection.delete).toHaveBeenCalledWith({
        where: { id: "conn-1" },
      });
    });

    it("should return 404 for nonexistent connection", async () => {
      const mockTenant = { id: "tenant-1", name: "Test Tenant", slug: "test-tenant" };

      vi.mocked(getOrCreateDemoTenant).mockResolvedValue(mockTenant as AnyMock);
      vi.mocked(prisma.wooCommerceConnection.findUnique).mockResolvedValue(null);

      const { DELETE } = await import("@/app/api/integrations/woocommerce/connections/[connectionId]/route");
      const request = new Request("http://localhost:3000/api/integrations/woocommerce/connections/kwc_nonexistent", {
        method: "DELETE",
      });
      const response = await DELETE(request, { params: Promise.resolve({ connectionId: "kwc_nonexistent" }) });
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe("Connection not found");
    });

    it("should return 404 when tenant A tries to delete tenant B's connection", async () => {
      const mockTenant = { id: "tenant-1", name: "Test Tenant", slug: "test-tenant" };
      const mockConnection = {
        id: "conn-1",
        connectionId: "kwc_abc123",
        tenantId: "tenant-2", // Different tenant
        siteUrl: "https://example.com",
        status: "active",
      };

      vi.mocked(getOrCreateDemoTenant).mockResolvedValue(mockTenant as AnyMock);
      vi.mocked(prisma.wooCommerceConnection.findUnique).mockResolvedValue(mockConnection as AnyMock);

      const { DELETE } = await import("@/app/api/integrations/woocommerce/connections/[connectionId]/route");
      const request = new Request("http://localhost:3000/api/integrations/woocommerce/connections/kwc_abc123", {
        method: "DELETE",
      });
      const response = await DELETE(request, { params: Promise.resolve({ connectionId: "kwc_abc123" }) });
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe("Connection not found");
      expect(prisma.wooCommerceConnection.delete).not.toHaveBeenCalled();
    });

    it("should not delete products when connection is deleted", async () => {
      const mockTenant = { id: "tenant-1", name: "Test Tenant", slug: "test-tenant" };
      const mockConnection = {
        id: "conn-1",
        connectionId: "kwc_abc123",
        tenantId: "tenant-1",
        siteUrl: "https://example.com",
        status: "active",
      };

      vi.mocked(getOrCreateDemoTenant).mockResolvedValue(mockTenant as AnyMock);
      vi.mocked(prisma.wooCommerceConnection.findUnique).mockResolvedValue(mockConnection as AnyMock);
      vi.mocked(prisma.wooCommerceConnection.delete).mockResolvedValue(mockConnection as AnyMock);

      const { DELETE } = await import("@/app/api/integrations/woocommerce/connections/[connectionId]/route");
      const request = new Request("http://localhost:3000/api/integrations/woocommerce/connections/kwc_abc123", {
        method: "DELETE",
      });
      await DELETE(request, { params: Promise.resolve({ connectionId: "kwc_abc123" }) });

      // Verify no product deletion was called
      expect(prisma.product.findMany).not.toHaveBeenCalled();
      expect(prisma.product.count).not.toHaveBeenCalled();
    });

    it("should not delete orders when connection is deleted", async () => {
      const mockTenant = { id: "tenant-1", name: "Test Tenant", slug: "test-tenant" };
      const mockConnection = {
        id: "conn-1",
        connectionId: "kwc_abc123",
        tenantId: "tenant-1",
        siteUrl: "https://example.com",
        status: "active",
      };

      vi.mocked(getOrCreateDemoTenant).mockResolvedValue(mockTenant as AnyMock);
      vi.mocked(prisma.wooCommerceConnection.findUnique).mockResolvedValue(mockConnection as AnyMock);
      vi.mocked(prisma.wooCommerceConnection.delete).mockResolvedValue(mockConnection as AnyMock);

      const { DELETE } = await import("@/app/api/integrations/woocommerce/connections/[connectionId]/route");
      const request = new Request("http://localhost:3000/api/integrations/woocommerce/connections/kwc_abc123", {
        method: "DELETE",
      });
      await DELETE(request, { params: Promise.resolve({ connectionId: "kwc_abc123" }) });

      // Verify no order deletion was called
      expect(prisma.order.findMany).not.toHaveBeenCalled();
      expect(prisma.order.count).not.toHaveBeenCalled();
    });

    it("should return 400 for invalid connection ID", async () => {
      const mockTenant = { id: "tenant-1", name: "Test Tenant", slug: "test-tenant" };
      vi.mocked(getOrCreateDemoTenant).mockResolvedValue(mockTenant as AnyMock);

      const { DELETE } = await import("@/app/api/integrations/woocommerce/connections/[connectionId]/route");
      const request = new Request("http://localhost:3000/api/integrations/woocommerce/connections/", {
        method: "DELETE",
      });
      const response = await DELETE(request, { params: Promise.resolve({ connectionId: "" }) });
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe("Invalid connection ID");
    });
  });
});
