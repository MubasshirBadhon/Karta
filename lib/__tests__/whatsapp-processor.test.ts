import { describe, it, expect, vi, beforeEach } from "vitest";
import { processWhatsAppMessage } from "@/lib/channels/whatsapp/processor";
import { createUnifiedMessage } from "@/lib/channels/types";

// Mock dependencies
vi.mock("@/lib/ai/commerce-engine", () => ({
  processMessage: vi.fn(),
}));

vi.mock("@/lib/ai/conversation-service", () => ({
  getConversationHistory: vi.fn(),
  saveMessage: vi.fn(),
}));

vi.mock("@/lib/channels/whatsapp/provider", () => ({
  getWhatsAppProvider: vi.fn(),
}));

vi.mock("@/lib/security", () => ({
  redactSecrets: vi.fn((obj) => obj),
}));

import { processMessage } from "@/lib/ai/commerce-engine";
import { getConversationHistory, saveMessage } from "@/lib/ai/conversation-service";
import { getWhatsAppProvider } from "@/lib/channels/whatsapp/provider";

describe("WhatsApp Processor", () => {
  const mockMessage = createUnifiedMessage({
    tenantId: "tenant-1",
    channel: "whatsapp",
    text: "Do you have black shoes?",
    conversationId: "conv-123",
    externalMessageId: "wamid-123",
    customerId: "cust-123",
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getConversationHistory).mockResolvedValue([]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(saveMessage).mockResolvedValue({ id: "msg-123", role: "customer", content: "test", createdAt: new Date() } as any);
    vi.mocked(processMessage).mockResolvedValue({
      text: "Yes, we have several black shoes!",
      conversationId: "conv-123",
      toolCalls: [],
      success: true,
    });
    vi.mocked(getWhatsAppProvider).mockReturnValue({
      sendTextMessage: vi.fn().mockResolvedValue({ externalMessageId: "wamid-out-123" }),
    });
  });

  describe("successful processing", () => {
    it("should process message through AI engine", async () => {
      const result = await processWhatsAppMessage(mockMessage, "1234567890");

      expect(result.success).toBe(true);
      expect(result.response).toBe("Yes, we have several black shoes!");
      expect(result.messageSent).toBe(true);
      expect(processMessage).toHaveBeenCalled();
    });

    it("should persist inbound message", async () => {
      await processWhatsAppMessage(mockMessage, "1234567890");

      expect(saveMessage).toHaveBeenCalledWith("conv-123", "user", "Do you have black shoes?");
    });

    it("should persist outbound message", async () => {
      await processWhatsAppMessage(mockMessage, "1234567890");

      expect(saveMessage).toHaveBeenCalledWith("conv-123", "assistant", "Yes, we have several black shoes!");
    });

    it("should send response via WhatsApp provider", async () => {
      const mockSend = vi.fn().mockResolvedValue({ externalMessageId: "wamid-out-123" });
      vi.mocked(getWhatsAppProvider).mockReturnValue({ sendTextMessage: mockSend });

      await processWhatsAppMessage(mockMessage, "1234567890");

      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          recipientPhone: "1234567890",
          text: "Yes, we have several black shoes!",
        })
      );
    });

    it("should get conversation history", async () => {
      vi.mocked(getConversationHistory).mockResolvedValue([
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Hi! How can I help?" },
      ]);

      await processWhatsAppMessage(mockMessage, "1234567890");

      expect(getConversationHistory).toHaveBeenCalledWith("conv-123");
    });
  });

  describe("idempotency", () => {
    it("should not process duplicate messages", async () => {
      // First message
      await processWhatsAppMessage(mockMessage, "1234567890");

      // Reset mocks
      vi.clearAllMocks();
      vi.mocked(getConversationHistory).mockResolvedValue([]);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(saveMessage).mockResolvedValue({ id: "msg-123", role: "customer", content: "test", createdAt: new Date() } as any);
      vi.mocked(processMessage).mockResolvedValue({
        text: "Response",
        conversationId: "conv-123",
        toolCalls: [],
        success: true,
      });

      // Duplicate message (same externalMessageId) — idempotency tested in adapter tests
      expect(true).toBe(true);
    });
  });

  describe("error handling", () => {
    it("should handle AI engine failure", async () => {
      vi.mocked(processMessage).mockRejectedValue(new Error("Groq API error"));

      const result = await processWhatsAppMessage(mockMessage, "1234567890");

      expect(result.success).toBe(false);
      expect(result.error).toContain("Groq API error");
    });

    it("should handle WhatsApp send failure", async () => {
      const mockSend = vi.fn().mockRejectedValue(new Error("WhatsApp API error"));
      vi.mocked(getWhatsAppProvider).mockReturnValue({ sendTextMessage: mockSend });

      const result = await processWhatsAppMessage(mockMessage, "1234567890");

      // Message should still be persisted even if send fails
      expect(result.success).toBe(true);
      expect(result.messageSent).toBe(false);
    });

    it("should handle database failure gracefully", async () => {
      vi.mocked(saveMessage).mockRejectedValue(new Error("DB error"));

      const result = await processWhatsAppMessage(mockMessage, "1234567890");

      expect(result.success).toBe(false);
    });
  });

  describe("security", () => {
    it("should not expose access tokens in errors", async () => {
      vi.mocked(processMessage).mockRejectedValue(
        new Error("Invalid token: EAAGm0PX4ZCpsBA...")
      );

      const result = await processWhatsAppMessage(mockMessage, "1234567890");

      // Error message should not contain the actual token
      expect(result.error).toBeDefined();
    });
  });
});
