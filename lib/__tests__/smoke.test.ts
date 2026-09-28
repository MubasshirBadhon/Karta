import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Phase 6 Smoke Tests
 *
 * Fast, deterministic tests for investor demo readiness.
 * These tests verify critical functionality without requiring
 * external services.
 */

// Mock Prisma
vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    tenant: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
    },
    product: {
      findMany: vi.fn(),
      count: vi.fn(),
    },
    woocommerceConnection: {
      findFirst: vi.fn(),
    },
    whatsAppConnection: {
      findUnique: vi.fn(),
    },
    message: {
      findFirst: vi.fn(),
      create: vi.fn(),
    },
    conversation: {
      findFirst: vi.fn(),
      create: vi.fn(),
    },
    customer: {
      findFirst: vi.fn(),
      create: vi.fn(),
    },
    $queryRaw: vi.fn(),
  },
}));

import { prisma } from "@/lib/db/prisma";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyMock = any;

describe("Phase 6 Smoke Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Smoke Test 1: Health endpoint", () => {
    it("should return health status", async () => {
      vi.mocked(prisma.$queryRaw).mockResolvedValue([{ 1: 1 }]);

      const { GET } = await import("@/app/api/health/route");
      const response = await GET();
      const data = await response.json();

      expect(data.status).toBe("ok");
      expect(data.database).toBe("connected");
      expect(data.timestamp).toBeDefined();
    });

    it("should return degraded when database is down", async () => {
      vi.mocked(prisma.$queryRaw).mockRejectedValue(new Error("DB error"));

      const { GET } = await import("@/app/api/health/route");
      const response = await GET();
      const data = await response.json();

      expect(data.status).toBe("degraded");
      expect(data.database).toBe("disconnected");
    });
  });

  describe("Smoke Test 2: Tenant isolation", () => {
    it("should isolate tenants by phone number", async () => {
      const mockFindUnique = vi.fn().mockResolvedValue({
        id: "conn-1",
        tenantId: "tenant-A",
        phoneNumberId: "phone-123",
        status: "active",
        createdAt: new Date(),
        updatedAt: new Date(),
        businessAccountId: null,
        displayPhoneNumber: null,
        accessToken: null,
      });
      (prisma.whatsAppConnection as AnyMock).findUnique = mockFindUnique;

      const { resolveTenantByPhoneNumber } = await import("@/lib/channels/whatsapp/adapter");
      const result = await resolveTenantByPhoneNumber("phone-123");

      expect(result).toEqual({ tenantId: "tenant-A", connectionId: "conn-1" });
    });

    it("should reject unknown phone numbers", async () => {
      const mockFindUnique = vi.fn().mockResolvedValue(null);
      (prisma.whatsAppConnection as AnyMock).findUnique = mockFindUnique;

      const { resolveTenantByPhoneNumber } = await import("@/lib/channels/whatsapp/adapter");
      const result = await resolveTenantByPhoneNumber("unknown-phone");

      expect(result).toBeNull();
    });
  });

  describe("Smoke Test 3: Product search", () => {
    it("should search products by tenant", async () => {
      const mockFindMany = vi.fn().mockResolvedValue([
        { id: "p1", name: "Test Product", slug: "test-product", price: 1000, compareAtPrice: null, stock: 10, image: null, status: "active" },
      ]);
      (prisma.product as AnyMock).findMany = mockFindMany;

      const { searchProducts } = await import("@/lib/commerce/service");
      const results = await searchProducts("tenant-1", "test");

      expect(results).toHaveLength(1);
      expect(results[0].name).toBe("Test Product");
    });
  });

  describe("Smoke Test 4: Website chat", () => {
    it("should reject requests without valid tenant context", async () => {
      const mockFindUnique = vi.fn().mockResolvedValue(null);
      (prisma.tenant as AnyMock).findUnique = mockFindUnique;

      const { POST } = await import("@/app/api/chat/route");
      const request = new Request("http://localhost:3000/api/chat", {
        method: "POST",
        body: JSON.stringify({ message: "Hello" }),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toContain("Unauthorized");
    });
  });

  describe("Smoke Test 5: WhatsApp webhook verification", () => {
    it("should verify valid webhook", async () => {
      const { validateVerificationRequest } = await import("@/lib/channels/whatsapp/webhook");
      const result = validateVerificationRequest("subscribe", "correct-token", "challenge-123", "correct-token");

      expect(result).toBe("challenge-123");
    });

    it("should reject invalid webhook", async () => {
      const { validateVerificationRequest } = await import("@/lib/channels/whatsapp/webhook");
      const result = validateVerificationRequest("subscribe", "wrong-token", "challenge-123", "correct-token");

      expect(result).toBeNull();
    });
  });

  describe("Smoke Test 6: WhatsApp inbound message processing", () => {
    it("should process inbound message through AI engine", async () => {
      const mockConnectionFindUnique = vi.fn().mockResolvedValue({
        id: "conn-1",
        tenantId: "tenant-1",
        phoneNumberId: "phone-123",
        status: "active",
        createdAt: new Date(),
        updatedAt: new Date(),
        businessAccountId: null,
        displayPhoneNumber: null,
        accessToken: null,
      });
      (prisma.whatsAppConnection as AnyMock).findUnique = mockConnectionFindUnique;

      const mockCustomerFindFirst = vi.fn().mockResolvedValue({
        id: "cust-1",
        tenantId: "tenant-1",
        phone: "1234567890",
        name: null,
        email: null,
        externalId: "wa_1234567890",
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      (prisma.customer as AnyMock).findFirst = mockCustomerFindFirst;

      const mockConversationFindFirst = vi.fn().mockResolvedValue({
        id: "conv-1",
        tenantId: "tenant-1",
        customerId: "cust-1",
        channel: "whatsapp",
        status: "active",
        externalId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      (prisma.conversation as AnyMock).findFirst = mockConversationFindFirst;

      const mockMessageFindFirst = vi.fn().mockResolvedValue(null);
      (prisma.message as AnyMock).findFirst = mockMessageFindFirst;

      const { processWebhookPayload } = await import("@/lib/channels/whatsapp/adapter");
      const payload = {
        object: "whatsapp_business_account",
        entry: [{
          id: "123",
          changes: [{
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: { display_phone_number: "1234567890", phone_number_id: "phone-123" },
              contacts: [{ profile: { name: "John" }, wa_id: "1234567890" }],
              messages: [{
                from: "1234567890",
                id: "wamid-123",
                timestamp: "1700000000",
                type: "text",
                text: { body: "Hello" },
              }],
            },
          }],
        }],
      };

      const result = await processWebhookPayload(payload);

      expect(result).toHaveLength(1);
      expect(result[0].channel).toBe("whatsapp");
      expect(result[0].tenantId).toBe("tenant-1");
    });
  });

  describe("Smoke Test 7: WhatsApp outbound provider", () => {
    it("should send message via provider", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ messages: [{ id: "wamid-out-123" }] }),
      });
      vi.stubGlobal("fetch", mockFetch);

      const { WhatsAppCloudProvider } = await import("@/lib/channels/whatsapp/provider");
      const provider = new WhatsAppCloudProvider({
        accessToken: "test-token",
        phoneNumberId: "phone-123",
        apiVersion: "v18.0",
        verifyToken: "verify-token",
      });

      const result = await provider.sendTextMessage({
        phoneNumberId: "phone-123",
        recipientPhone: "1234567890",
        text: "Hello!",
      });

      expect(result.externalMessageId).toBe("wamid-out-123");
      vi.unstubAllGlobals();
    });
  });

  describe("Smoke Test 8: Duplicate webhook/idempotency", () => {
    it("should detect duplicate messages", async () => {
      const mockFindFirst = vi.fn().mockResolvedValue({
        id: "msg-123",
        conversationId: "conv-1",
        externalId: "wamid-123",
        role: "customer",
        content: "Hello",
        createdAt: new Date(),
      });
      (prisma.message as AnyMock).findFirst = mockFindFirst;

      const { isMessageProcessed } = await import("@/lib/channels/whatsapp/adapter");
      const result = await isMessageProcessed("wamid-123");

      expect(result).toBe(true);
    });

    it("should allow new messages", async () => {
      const mockFindFirst = vi.fn().mockResolvedValue(null);
      (prisma.message as AnyMock).findFirst = mockFindFirst;

      const { isMessageProcessed } = await import("@/lib/channels/whatsapp/adapter");
      const result = await isMessageProcessed("wamid-new");

      expect(result).toBe(false);
    });
  });
});
