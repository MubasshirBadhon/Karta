import { describe, it, expect } from "vitest";
import {
  createUnifiedMessage,
  type Channel,
  type UnifiedMessage,
} from "@/lib/channels/types";

describe("Channel Abstraction", () => {
  describe("createUnifiedMessage", () => {
    it("should create a UnifiedMessage with required fields", () => {
      const msg = createUnifiedMessage({
        tenantId: "tenant-1",
        channel: "web",
        text: "Hello, I'm looking for a product",
      });

      expect(msg.tenantId).toBe("tenant-1");
      expect(msg.channel).toBe("web");
      expect(msg.text).toBe("Hello, I'm looking for a product");
      expect(msg.timestamp).toBeDefined();
    });

    it("should include optional fields when provided", () => {
      const msg = createUnifiedMessage({
        tenantId: "tenant-1",
        channel: "whatsapp",
        text: "Do you have this in black?",
        conversationId: "conv-123",
        externalMessageId: "wamid-xyz",
        customerId: "cust-456",
        timestamp: "2024-01-15T10:30:00Z",
      });

      expect(msg.conversationId).toBe("conv-123");
      expect(msg.externalMessageId).toBe("wamid-xyz");
      expect(msg.customerId).toBe("cust-456");
      expect(msg.timestamp).toBe("2024-01-15T10:30:00Z");
    });

    it("should auto-generate timestamp when not provided", () => {
      const before = new Date().toISOString();
      const msg = createUnifiedMessage({
        tenantId: "tenant-1",
        channel: "web",
        text: "Test",
      });
      const after = new Date().toISOString();

      expect(msg.timestamp >= before).toBe(true);
      expect(msg.timestamp <= after).toBe(true);
    });

    it("should support web channel", () => {
      const msg = createUnifiedMessage({
        tenantId: "tenant-1",
        channel: "web",
        text: "Web message",
      });
      expect(msg.channel).toBe("web");
    });

    it("should support whatsapp channel", () => {
      const msg = createUnifiedMessage({
        tenantId: "tenant-1",
        channel: "whatsapp",
        text: "WhatsApp message",
      });
      expect(msg.channel).toBe("whatsapp");
    });
  });

  describe("Channel type", () => {
    it("should accept 'web' as a valid channel", () => {
      const channel: Channel = "web";
      expect(channel).toBe("web");
    });

    it("should accept 'whatsapp' as a valid channel", () => {
      const channel: Channel = "whatsapp";
      expect(channel).toBe("whatsapp");
    });
  });

  describe("UnifiedMessage structure", () => {
    it("should have the correct shape", () => {
      const msg: UnifiedMessage = {
        tenantId: "t1",
        channel: "web",
        conversationId: "c1",
        externalMessageId: "em1",
        customerId: "cu1",
        text: "Hello",
        timestamp: "2024-01-01T00:00:00Z",
      };

      expect(msg).toHaveProperty("tenantId");
      expect(msg).toHaveProperty("channel");
      expect(msg).toHaveProperty("conversationId");
      expect(msg).toHaveProperty("externalMessageId");
      expect(msg).toHaveProperty("customerId");
      expect(msg).toHaveProperty("text");
      expect(msg).toHaveProperty("timestamp");
    });
  });
});
