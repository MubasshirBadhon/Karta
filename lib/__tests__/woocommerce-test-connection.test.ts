import { describe, it, expect, beforeEach, vi } from "vitest";
import { createHmac } from "crypto";
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

describe("WooCommerce Test Connection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("valid per-connection credentials", () => {
    it("should succeed with valid credentials", async () => {
      vi.mocked(prisma.wooCommerceConnection.findUnique).mockResolvedValue({
        id: "conn-1",
        tenantId: "tenant-1",
        siteUrl: "https://example.com",
        siteName: "Test Store",
        connectionId: "kwc_abc123",
        connectionSecret: "valid-secret",
        status: "active",
        lastSyncAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const headers = generateAuthHeaders("kwc_abc123", "valid-secret");
      const result = await authenticateWordPressRequest(
        headers["X-Karta-Connection-Id"],
        headers["X-Karta-Timestamp"],
        headers["X-Karta-Signature"]
      );

      expect(result.success).toBe(true);
      expect(result.tenantId).toBe("tenant-1");
      expect(result.connectionId).toBe("kwc_abc123");
    });
  });

  describe("invalid credentials", () => {
    it("should fail with invalid secret", async () => {
      vi.mocked(prisma.wooCommerceConnection.findUnique).mockResolvedValue({
        id: "conn-1",
        tenantId: "tenant-1",
        siteUrl: "https://example.com",
        siteName: "Test Store",
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
      expect(result.error).toBe("Invalid signature");
    });

    it("should fail with invalid connection ID", async () => {
      vi.mocked(prisma.wooCommerceConnection.findUnique).mockResolvedValue(null);

      const headers = generateAuthHeaders("kwc_invalid", "any-secret");
      const result = await authenticateWordPressRequest(
        headers["X-Karta-Connection-Id"],
        headers["X-Karta-Timestamp"],
        headers["X-Karta-Signature"]
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe("Invalid connection");
    });

    it("should fail with expired timestamp", async () => {
      vi.mocked(prisma.wooCommerceConnection.findUnique).mockResolvedValue({
        id: "conn-1",
        tenantId: "tenant-1",
        siteUrl: "https://example.com",
        siteName: "Test Store",
        connectionId: "kwc_abc123",
        connectionSecret: "valid-secret",
        status: "active",
        lastSyncAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      // Create a timestamp from 10 minutes ago
      const oldTimestamp = (Math.floor(Date.now() / 1000) - 600).toString();
      const signature = createHmac("sha256", "valid-secret")
        .update("kwc_abc123" + oldTimestamp)
        .digest("hex");

      const result = await authenticateWordPressRequest(
        "kwc_abc123",
        oldTimestamp,
        signature
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe("Request timestamp too old");
    });
  });

  describe("tenant isolation", () => {
    it("should resolve tenant from connection, not from client input", async () => {
      vi.mocked(prisma.wooCommerceConnection.findUnique).mockResolvedValue({
        id: "conn-1",
        tenantId: "tenant-A",
        siteUrl: "https://example.com",
        siteName: "Test Store",
        connectionId: "kwc_abc123",
        connectionSecret: "valid-secret",
        status: "active",
        lastSyncAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const headers = generateAuthHeaders("kwc_abc123", "valid-secret");
      const result = await authenticateWordPressRequest(
        headers["X-Karta-Connection-Id"],
        headers["X-Karta-Timestamp"],
        headers["X-Karta-Signature"]
      );

      // Tenant should be resolved from the connection record
      expect(result.tenantId).toBe("tenant-A");
    });
  });

  describe("plugin/API response compatibility", () => {
    it("should return success response format expected by WordPress", async () => {
      vi.mocked(prisma.wooCommerceConnection.findUnique).mockResolvedValue({
        id: "conn-1",
        tenantId: "tenant-1",
        siteUrl: "https://example.com",
        siteName: "Test Store",
        connectionId: "kwc_abc123",
        connectionSecret: "valid-secret",
        status: "active",
        lastSyncAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const headers = generateAuthHeaders("kwc_abc123", "valid-secret");
      const result = await authenticateWordPressRequest(
        headers["X-Karta-Connection-Id"],
        headers["X-Karta-Timestamp"],
        headers["X-Karta-Signature"]
      );

      // Response should have success flag and tenant info
      expect(result).toHaveProperty("success", true);
      expect(result).toHaveProperty("tenantId");
      expect(result).toHaveProperty("connectionId");
    });
  });
});
