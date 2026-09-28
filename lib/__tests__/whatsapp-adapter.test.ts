import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  resolveTenantByPhoneNumber,
  getOrCreateCustomer,
  getOrCreateWhatsAppConversation,
  isMessageProcessed,
  toUnifiedMessage,
} from "@/lib/channels/whatsapp/adapter";
import type { ParsedWhatsAppMessage } from "@/lib/channels/whatsapp/parser";

// Mock Prisma
vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    whatsAppConnection: {
      findUnique: vi.fn(),
    },
    customer: {
      findFirst: vi.fn(),
      create: vi.fn(),
    },
    conversation: {
      findFirst: vi.fn(),
      create: vi.fn(),
    },
    message: {
      findFirst: vi.fn(),
    },
  },
}));

import { prisma } from "@/lib/db/prisma";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyMock = any;

describe("WhatsApp Adapter", () => {
  const mockParsedMessage: ParsedWhatsAppMessage = {
    externalMessageId: "wamid-123",
    senderPhone: "1234567890",
    senderName: "John",
    text: "Hello",
    timestamp: "2024-01-01T00:00:00.000Z",
    phoneNumberId: "phone-123",
    messageType: "text",
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("resolveTenantByPhoneNumber", () => {
    it("should resolve tenant from phone number ID", async () => {
      vi.mocked(prisma.whatsAppConnection.findUnique).mockResolvedValue({
        id: "conn-123",
        tenantId: "tenant-1",
        phoneNumberId: "phone-123",
        status: "active",
      } as AnyMock);

      const result = await resolveTenantByPhoneNumber("phone-123");
      expect(result).toEqual({ tenantId: "tenant-1", connectionId: "conn-123" });
    });

    it("should return null for unknown phone number", async () => {
      vi.mocked(prisma.whatsAppConnection.findUnique).mockResolvedValue(null);

      const result = await resolveTenantByPhoneNumber("unknown-phone");
      expect(result).toBeNull();
    });

    it("should return null for inactive connection", async () => {
      vi.mocked(prisma.whatsAppConnection.findUnique).mockResolvedValue({
        id: "conn-123",
        tenantId: "tenant-1",
        phoneNumberId: "phone-123",
        status: "disconnected",
      } as AnyMock);

      const result = await resolveTenantByPhoneNumber("phone-123");
      expect(result).toBeNull();
    });
  });

  describe("getOrCreateCustomer", () => {
    it("should return existing customer", async () => {
      vi.mocked(prisma.customer.findFirst).mockResolvedValue({
        id: "cust-123",
        tenantId: "tenant-1",
        phone: "1234567890",
      } as AnyMock);

      const result = await getOrCreateCustomer("tenant-1", "1234567890", "John");
      expect(result.id).toBe("cust-123");
      expect(prisma.customer.create).not.toHaveBeenCalled();
    });

    it("should create new customer if not exists", async () => {
      vi.mocked(prisma.customer.findFirst).mockResolvedValue(null);
      vi.mocked(prisma.customer.create).mockResolvedValue({
        id: "cust-456",
        tenantId: "tenant-1",
        phone: "1234567890",
      } as AnyMock);

      const result = await getOrCreateCustomer("tenant-1", "1234567890", "John");
      expect(result.id).toBe("cust-456");
      expect(prisma.customer.create).toHaveBeenCalled();
    });
  });

  describe("getOrCreateWhatsAppConversation", () => {
    it("should return existing conversation", async () => {
      vi.mocked(prisma.conversation.findFirst).mockResolvedValue({
        id: "conv-123",
        tenantId: "tenant-1",
        customerId: "cust-123",
        channel: "whatsapp",
      } as AnyMock);

      const result = await getOrCreateWhatsAppConversation("tenant-1", "cust-123");
      expect(result.id).toBe("conv-123");
    });

    it("should create new conversation if not exists", async () => {
      vi.mocked(prisma.conversation.findFirst).mockResolvedValue(null);
      vi.mocked(prisma.conversation.create).mockResolvedValue({
        id: "conv-456",
        tenantId: "tenant-1",
        customerId: "cust-123",
      } as AnyMock);

      const result = await getOrCreateWhatsAppConversation("tenant-1", "cust-123");
      expect(result.id).toBe("conv-456");
    });
  });

  describe("isMessageProcessed", () => {
    it("should return true for duplicate message", async () => {
      vi.mocked(prisma.message.findFirst).mockResolvedValue({
        id: "msg-123",
        externalId: "wamid-123",
      } as AnyMock);

      const result = await isMessageProcessed("wamid-123");
      expect(result).toBe(true);
    });

    it("should return false for new message", async () => {
      vi.mocked(prisma.message.findFirst).mockResolvedValue(null);

      const result = await isMessageProcessed("wamid-new");
      expect(result).toBe(false);
    });
  });

  describe("toUnifiedMessage", () => {
    it("should convert parsed message to UnifiedMessage", async () => {
      vi.mocked(prisma.whatsAppConnection.findUnique).mockResolvedValue({
        id: "conn-123",
        tenantId: "tenant-1",
        phoneNumberId: "phone-123",
        status: "active",
      } as AnyMock);
      vi.mocked(prisma.customer.findFirst).mockResolvedValue({
        id: "cust-123",
        tenantId: "tenant-1",
        phone: "1234567890",
      } as AnyMock);
      vi.mocked(prisma.conversation.findFirst).mockResolvedValue({
        id: "conv-123",
        tenantId: "tenant-1",
        customerId: "cust-123",
      } as AnyMock);

      const result = await toUnifiedMessage(mockParsedMessage);

      expect(result).not.toBeNull();
      expect(result!.channel).toBe("whatsapp");
      expect(result!.tenantId).toBe("tenant-1");
      expect(result!.text).toBe("Hello");
      expect(result!.externalMessageId).toBe("wamid-123");
    });

    it("should return null for unknown phone number", async () => {
      vi.mocked(prisma.whatsAppConnection.findUnique).mockResolvedValue(null);

      const result = await toUnifiedMessage(mockParsedMessage);
      expect(result).toBeNull();
    });
  });
});
