import { describe, it, expect, beforeEach, vi } from "vitest";
import { getOrCreateDemoTenant, getDemoTenantId } from "@/lib/tenant/resolution";

// Mock the Prisma module
vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    tenant: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
    },
  },
}));

import { prisma } from "@/lib/db/prisma";

describe("Tenant Resolution", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("getOrCreateDemoTenant", () => {
    it("should return existing demo tenant", async () => {
      vi.mocked(prisma.tenant.findUnique).mockResolvedValue({
        id: "tenant-1",
        name: "Karta Demo Store",
        slug: "karta-demo-store",
      inventoryMode: "unlimited",
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await getOrCreateDemoTenant();

      expect(result).not.toBeNull();
      expect(result?.name).toBe("Karta Demo Store");
      expect(result?.slug).toBe("karta-demo-store");
      expect(prisma.tenant.create).not.toHaveBeenCalled();
    });

    it("should create demo tenant if it doesn't exist", async () => {
      vi.mocked(prisma.tenant.findUnique).mockResolvedValue(null);
      vi.mocked(prisma.tenant.create).mockResolvedValue({
        id: "tenant-1",
        name: "Karta Demo Store",
        slug: "karta-demo-store",
      inventoryMode: "unlimited",
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await getOrCreateDemoTenant();

      expect(result).not.toBeNull();
      expect(result?.name).toBe("Karta Demo Store");
      expect(prisma.tenant.create).toHaveBeenCalledWith({
        data: {
          name: "Karta Demo Store",
          slug: "karta-demo-store",
        },
      });
    });

    it("should be idempotent - return same tenant on multiple calls", async () => {
      vi.mocked(prisma.tenant.findUnique).mockResolvedValue({
        id: "tenant-1",
        name: "Karta Demo Store",
        slug: "karta-demo-store",
      inventoryMode: "unlimited",
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result1 = await getOrCreateDemoTenant();
      const result2 = await getOrCreateDemoTenant();

      expect(result1?.id).toBe(result2?.id);
      expect(prisma.tenant.create).not.toHaveBeenCalled();
    });

    it("should return null on database error", async () => {
      vi.mocked(prisma.tenant.findUnique).mockRejectedValue(new Error("DB error"));

      const result = await getOrCreateDemoTenant();

      expect(result).toBeNull();
    });
  });

  describe("getDemoTenantId", () => {
    it("should return tenant ID", async () => {
      vi.mocked(prisma.tenant.findUnique).mockResolvedValue({
        id: "tenant-1",
        name: "Karta Demo Store",
        slug: "karta-demo-store",
      inventoryMode: "unlimited",
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await getDemoTenantId();

      expect(result).toBe("tenant-1");
    });

    it("should return null if tenant doesn't exist", async () => {
      vi.mocked(prisma.tenant.findUnique).mockResolvedValue(null);

      const result = await getDemoTenantId();

      expect(result).toBeNull();
    });
  });

  describe("security", () => {
    it("should not accept client-supplied tenantId", async () => {
      // The function takes no parameters - tenant is resolved server-side
      await getOrCreateDemoTenant();

      // Should always use the demo tenant slug, not any client input
      expect(prisma.tenant.findUnique).toHaveBeenCalledWith({
        where: { slug: "karta-demo-store" },
      });
    });

    it("should not use first-tenant fallback", async () => {
      await getOrCreateDemoTenant();

      // Should use findUnique with specific slug, not findFirst
      expect(prisma.tenant.findUnique).toHaveBeenCalled();
      expect(prisma.tenant.findFirst).not.toHaveBeenCalled();
    });
  });
});
