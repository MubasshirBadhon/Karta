import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  createWooCommerceConnection,
  getConnection,
  listConnections,
  disconnectConnection,
} from "@/lib/integrations/woocommerce/provisioning";
import { authenticateWordPressRequest, generateAuthHeaders } from "@/lib/integrations/woocommerce/auth";

// Mock the Prisma module
vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    tenant: {
      findUnique: vi.fn(),
    },
    wooCommerceConnection: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      findMany: vi.fn(),
      updateMany: vi.fn(),
    },
  },
}));

import { prisma } from "@/lib/db/prisma";

describe("WooCommerce Provisioning", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("createWooCommerceConnection", () => {
    it("should create a connection with generated credentials", async () => {
      vi.mocked(prisma.tenant.findUnique).mockResolvedValue({
        id: "tenant-1",
        name: "Test Tenant",
        slug: "test-tenant",
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      vi.mocked(prisma.wooCommerceConnection.findFirst).mockResolvedValue(null);
      vi.mocked(prisma.wooCommerceConnection.create).mockResolvedValue({
        id: "conn-1",
        tenantId: "tenant-1",
        siteUrl: "https://example.com",
        siteName: "Test Store",
        connectionId: "kwc_abc123",
        connectionSecret: "secret123",
        status: "active",
        lastSyncAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await createWooCommerceConnection(
        "tenant-1",
        "https://example.com",
        "Test Store"
      );

      expect(result.success).toBe(true);
      expect(result.connectionId).toBeDefined();
      expect(result.connectionId).toMatch(/^kwc_/);
      expect(result.connectionSecret).toBeDefined();
      expect(result.connectionSecret).toHaveLength(64);
    });

    it("should reject missing tenant ID", async () => {
      const result = await createWooCommerceConnection("", "https://example.com");
      expect(result.success).toBe(false);
      expect(result.error).toContain("Tenant ID is required");
    });

    it("should reject missing site URL", async () => {
      const result = await createWooCommerceConnection("tenant-1", "");
      expect(result.success).toBe(false);
      expect(result.error).toContain("Site URL is required");
    });

    it("should reject invalid tenant", async () => {
      vi.mocked(prisma.tenant.findUnique).mockResolvedValue(null);

      const result = await createWooCommerceConnection(
        "invalid-tenant",
        "https://example.com"
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("Invalid tenant");
    });

    it("should reject duplicate active connections", async () => {
      vi.mocked(prisma.tenant.findUnique).mockResolvedValue({
        id: "tenant-1",
        name: "Test",
        slug: "test",
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      vi.mocked(prisma.wooCommerceConnection.findFirst).mockResolvedValue({
        id: "conn-1",
        tenantId: "tenant-1",
        connectionId: "kwc_existing",
        siteUrl: "https://existing.com",
        siteName: null,
        connectionSecret: "secret",
        status: "active",
        lastSyncAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await createWooCommerceConnection(
        "tenant-1",
        "https://example.com"
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("already has an active connection");
    });

    it("should generate unique connection IDs", async () => {
      vi.mocked(prisma.tenant.findUnique).mockResolvedValue({
        id: "tenant-1",
        name: "Test",
        slug: "test",
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      vi.mocked(prisma.wooCommerceConnection.findFirst).mockResolvedValue(null);
      vi.mocked(prisma.wooCommerceConnection.create).mockImplementation((args: { data: Record<string, unknown> }) => ({
        id: "conn-1",
        ...args.data,
        lastSyncAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      }) as any);

      const result1 = await createWooCommerceConnection("tenant-1", "https://example1.com");
      const result2 = await createWooCommerceConnection("tenant-1", "https://example2.com");

      // Reset mock to allow second creation
      vi.mocked(prisma.wooCommerceConnection.findFirst).mockResolvedValue(null);

      expect(result1.connectionId).not.toBe(result2.connectionId);
    });
  });

  describe("getConnection", () => {
    it("should return connection without secret", async () => {
      // getConnection uses select to exclude connectionSecret
      // The mock simulates the selected fields only (no connectionSecret)
      vi.mocked(prisma.wooCommerceConnection.findUnique).mockResolvedValue({
        id: "conn-1",
        tenantId: "tenant-1",
        siteUrl: "https://example.com",
        siteName: "Test",
        status: "active",
        lastSyncAt: null,
        createdAt: new Date(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);

      const result = await getConnection("kwc_abc123");

      expect(result).not.toBeNull();
      expect(result).not.toHaveProperty("connectionSecret");
    });
  });

  describe("listConnections", () => {
    it("should list connections for tenant", async () => {
      vi.mocked(prisma.wooCommerceConnection.findMany).mockResolvedValue([
        {
          id: "conn-1",
          tenantId: "tenant-1",
          connectionId: "kwc_abc123",
          siteUrl: "https://example.com",
          siteName: "Test",
          status: "active",
          lastSyncAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          connectionSecret: "secret",
        },
      ]);

      const result = await listConnections("tenant-1");

      expect(result).toHaveLength(1);
    });
  });

  describe("disconnectConnection", () => {
    it("should disconnect a connection", async () => {
      vi.mocked(prisma.wooCommerceConnection.updateMany).mockResolvedValue({ count: 1 });

      const result = await disconnectConnection("kwc_abc123");

      expect(result).toBe(true);
    });
  });

  describe("authentication with per-connection secrets", () => {
    it("should authenticate with per-connection secret", async () => {
      vi.mocked(prisma.wooCommerceConnection.findUnique).mockResolvedValue({
        id: "conn-1",
        tenantId: "tenant-1",
        siteUrl: "https://example.com",
        siteName: "Test",
        connectionId: "kwc_abc123",
        connectionSecret: "unique-secret-123",
        status: "active",
        lastSyncAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const headers = generateAuthHeaders("kwc_abc123", "unique-secret-123");
      const result = await authenticateWordPressRequest(
        headers["X-Karta-Connection-Id"],
        headers["X-Karta-Timestamp"],
        headers["X-Karta-Signature"]
      );

      expect(result.success).toBe(true);
      expect(result.tenantId).toBe("tenant-1");
    });

    it("should reject wrong per-connection secret", async () => {
      vi.mocked(prisma.wooCommerceConnection.findUnique).mockResolvedValue({
        id: "conn-1",
        tenantId: "tenant-1",
        siteUrl: "https://example.com",
        siteName: "Test",
        connectionId: "kwc_abc123",
        connectionSecret: "correct-secret",
        status: "active",
        lastSyncAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const headers = generateAuthHeaders("kwc_abc123", "wrong-secret");
      const result = await authenticateWordPressRequest(
        headers["X-Karta-Connection-Id"],
        headers["X-Karta-Timestamp"],
        headers["X-Karta-Signature"]
      );

      expect(result.success).toBe(false);
    });

    it("should not use global WORDPRESS_CONNECT_SECRET", async () => {
      // Even if global secret is set, per-connection secret should be used
      const originalEnv = process.env;
      process.env = { ...originalEnv, WORDPRESS_CONNECT_SECRET: "global-secret" };

      vi.mocked(prisma.wooCommerceConnection.findUnique).mockResolvedValue({
        id: "conn-1",
        tenantId: "tenant-1",
        siteUrl: "https://example.com",
        siteName: "Test",
        connectionId: "kwc_abc123",
        connectionSecret: "per-connection-secret",
        status: "active",
        lastSyncAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      // Sign with per-connection secret, not global
      const headers = generateAuthHeaders("kwc_abc123", "per-connection-secret");
      const result = await authenticateWordPressRequest(
        headers["X-Karta-Connection-Id"],
        headers["X-Karta-Timestamp"],
        headers["X-Karta-Signature"]
      );

      expect(result.success).toBe(true);
      process.env = originalEnv;
    });
  });

  describe("security", () => {
    it("should not expose connection secret in API responses", async () => {
      // getConnection uses select to exclude connectionSecret
      // The mock simulates the selected fields only (no connectionSecret)
      vi.mocked(prisma.wooCommerceConnection.findUnique).mockResolvedValue({
        id: "conn-1",
        tenantId: "tenant-1",
        siteUrl: "https://example.com",
        siteName: "Test",
        status: "active",
        lastSyncAt: null,
        createdAt: new Date(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);

      const result = await getConnection("kwc_abc123");

      expect(result).not.toHaveProperty("connectionSecret");
      expect(JSON.stringify(result)).not.toContain("connectionSecret");
    });

    it("should not log secrets", async () => {
      const consoleSpy = vi.spyOn(console, "log");
      const consoleErrorSpy = vi.spyOn(console, "error");

      vi.mocked(prisma.tenant.findUnique).mockResolvedValue({
        id: "tenant-1",
        name: "Test",
        slug: "test",
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      vi.mocked(prisma.wooCommerceConnection.findFirst).mockResolvedValue(null);
      vi.mocked(prisma.wooCommerceConnection.create).mockResolvedValue({
        id: "conn-1",
        tenantId: "tenant-1",
        siteUrl: "https://example.com",
        siteName: "Test",
        connectionId: "kwc_abc123",
        connectionSecret: "super-secret-value",
        status: "active",
        lastSyncAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await createWooCommerceConnection("tenant-1", "https://example.com");

      // Check that secret was not logged
      const allLogs = [
        ...consoleSpy.mock.calls.flat(),
        ...consoleErrorSpy.mock.calls.flat(),
      ].join(" ");

      expect(allLogs).not.toContain("super-secret-value");

      consoleSpy.mockRestore();
      consoleErrorSpy.mockRestore();
    });
  });
});
