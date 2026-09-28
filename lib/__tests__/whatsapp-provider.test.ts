import { describe, it, expect, vi, beforeEach } from "vitest";
import { WhatsAppCloudProvider } from "@/lib/channels/whatsapp/provider";

describe("WhatsApp Provider", () => {
  const mockConfig = {
    accessToken: "test-token",
    phoneNumberId: "phone-123",
    businessAccountId: "biz-123",
    apiVersion: "v18.0",
    verifyToken: "verify-token",
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("WhatsAppCloudProvider", () => {
    it("should send text message successfully", async () => {
      const provider = new WhatsAppCloudProvider(mockConfig);

      const mockResponse = {
        messaging_product: "whatsapp",
        contacts: [{ input: "1234567890", wa_id: "1234567890" }],
        messages: [{ id: "wamid-123" }],
      };

      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: true,
          json: () => Promise.resolve(mockResponse),
        })
      );

      const result = await provider.sendTextMessage({
        phoneNumberId: "phone-123",
        recipientPhone: "1234567890",
        text: "Hello!",
      });

      expect(result.externalMessageId).toBe("wamid-123");
      vi.unstubAllGlobals();
    });

    it("should throw on API error", async () => {
      const provider = new WhatsAppCloudProvider(mockConfig);

      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: false,
          status: 400,
          text: () => Promise.resolve("Bad Request"),
        })
      );

      await expect(
        provider.sendTextMessage({
          phoneNumberId: "phone-123",
          recipientPhone: "1234567890",
          text: "Hello!",
        })
      ).rejects.toThrow("WhatsApp API error");

      vi.unstubAllGlobals();
    });

    it("should throw when no message ID returned", async () => {
      const provider = new WhatsAppCloudProvider(mockConfig);

      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: true,
          json: () => Promise.resolve({ messages: [] }),
        })
      );

      await expect(
        provider.sendTextMessage({
          phoneNumberId: "phone-123",
          recipientPhone: "1234567890",
          text: "Hello!",
        })
      ).rejects.toThrow("no message ID");

      vi.unstubAllGlobals();
    });
  });
});
