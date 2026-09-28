import { describe, it, expect, beforeEach, vi } from "vitest";
import { authenticateWordPressRequest, generateAuthHeaders } from "@/lib/integrations/woocommerce/auth";

// Mock the Prisma module
vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    wooCommerceConnection: {
      findUnique: vi.fn(),
    },
  },
}));

import { prisma } from "@/lib/db/prisma";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyMock = any;

describe("WooCommerce Authentication", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv, WORDPRESS_CONNECT_SECRET: "test-secret" };
    vi.clearAllMocks();
  });

  describe("authenticateWordPressRequest", () => {
    it("should reject missing headers", async () => {
      const result = await authenticateWordPressRequest(null, null, null);
      expect(result.success).toBe(false);
      expect(result.error).toBe("Missing authentication headers");
    });

    it("should reject invalid timestamp", async () => {
      const result = await authenticateWordPressRequest("conn-123", "not-a-number", "sig");
      expect(result.success).toBe(false);
      expect(result.error).toBe("Invalid timestamp");
    });

    it("should reject old timestamps (replay protection)", async () => {
      const oldTimestamp = (Math.floor(Date.now() / 1000) - 600).toString();
      const result = await authenticateWordPressRequest("conn-123", oldTimestamp, "sig");
      expect(result.success).toBe(false);
      expect(result.error).toBe("Request timestamp too old");
    });

    it("should reject invalid connection ID", async () => {
      vi.mocked(prisma.wooCommerceConnection.findUnique).mockResolvedValue(null);

      const timestamp = Math.floor(Date.now() / 1000).toString();
      const result = await authenticateWordPressRequest("invalid-conn", timestamp, "sig");
      expect(result.success).toBe(false);
      expect(result.error).toBe("Invalid connection");
    });

    it("should reject inactive connections", async () => {
      vi.mocked(prisma.wooCommerceConnection.findUnique).mockResolvedValue({
        id: "conn-123",
        tenantId: "tenant-1",
        siteUrl: "https://example.com",
        siteName: "Test Store",
        connectionId: "conn-123",
        status: "disconnected",
        lastSyncAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        tenant: { id: "tenant-1", name: "Test", slug: "test", createdAt: new Date(), updatedAt: new Date() },
      } as AnyMock);

      const timestamp = Math.floor(Date.now() / 1000).toString();
      const result = await authenticateWordPressRequest("conn-123", timestamp, "sig");
      expect(result.success).toBe(false);
      expect(result.error).toBe("Connection is not active");
    });

    it("should reject invalid signature", async () => {
      vi.mocked(prisma.wooCommerceConnection.findUnique).mockResolvedValue({
        id: "conn-123",
        tenantId: "tenant-1",
        siteUrl: "https://example.com",
        siteName: "Test Store",
        connectionId: "conn-123",
        status: "active",
        lastSyncAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        tenant: { id: "tenant-1", name: "Test", slug: "test", createdAt: new Date(), updatedAt: new Date() },
      } as AnyMock);

      const timestamp = Math.floor(Date.now() / 1000).toString();
      const result = await authenticateWordPressRequest("conn-123", timestamp, "invalid-sig");
      expect(result.success).toBe(false);
      expect(result.error).toBe("Invalid signature");
    });

    it("should accept valid authentication", async () => {
      vi.mocked(prisma.wooCommerceConnection.findUnique).mockResolvedValue({
        id: "conn-123",
        tenantId: "tenant-1",
        siteUrl: "https://example.com",
        siteName: "Test Store",
        connectionId: "conn-123",
        status: "active",
        lastSyncAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        tenant: { id: "tenant-1", name: "Test", slug: "test", createdAt: new Date(), updatedAt: new Date() },
      } as AnyMock);

      const headers = generateAuthHeaders("conn-123", "test-secret");
      const result = await authenticateWordPressRequest(
        headers["X-Karta-Connection-Id"],
        headers["X-Karta-Timestamp"],
        headers["X-Karta-Signature"]
      );

      expect(result.success).toBe(true);
      expect(result.tenantId).toBe("tenant-1");
      expect(result.connectionId).toBe("conn-123");
    });
  });

  describe("generateAuthHeaders", () => {
    it("should generate valid headers", () => {
      const headers = generateAuthHeaders("conn-123", "test-secret");
      expect(headers["X-Karta-Connection-Id"]).toBe("conn-123");
      expect(headers["X-Karta-Timestamp"]).toBeDefined();
      expect(headers["X-Karta-Signature"]).toBeDefined();
    });
  });
});
