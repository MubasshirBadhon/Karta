import { describe, it, expect } from "vitest";
import { createHmac } from "crypto";
import { verifyWebhookSignature, validateVerificationRequest, isValidWebhookPayload } from "@/lib/channels/whatsapp/webhook";
import { parseWhatsAppPayload, isSupportedMessage } from "@/lib/channels/whatsapp/parser";
import type { WhatsAppWebhookPayload, WhatsAppMessage } from "@/lib/channels/whatsapp/types";

describe("WhatsApp Webhook", () => {
  describe("verifyWebhookSignature", () => {
    it("should verify valid signature", () => {
      const payload = '{"test": "data"}';
      const secret = "test-secret";
      const signature = createHmac("sha256", secret).update(payload).digest("hex");

      expect(verifyWebhookSignature(payload, signature, secret)).toBe(true);
    });

    it("should reject invalid signature", () => {
      const payload = '{"test": "data"}';
      const secret = "test-secret";

      expect(verifyWebhookSignature(payload, "invalid-signature", secret)).toBe(false);
    });

    it("should reject wrong secret", () => {
      const payload = '{"test": "data"}';
      const signature = createHmac("sha256", "wrong-secret").update(payload).digest("hex");

      expect(verifyWebhookSignature(payload, signature, "test-secret")).toBe(false);
    });
  });

  describe("validateVerificationRequest", () => {
    it("should return challenge for valid token", () => {
      const result = validateVerificationRequest("subscribe", "correct-token", "challenge-123", "correct-token");
      expect(result).toBe("challenge-123");
    });

    it("should reject invalid token", () => {
      const result = validateVerificationRequest("subscribe", "wrong-token", "challenge-123", "correct-token");
      expect(result).toBeNull();
    });

    it("should reject non-subscribe mode", () => {
      const result = validateVerificationRequest("other", "correct-token", "challenge-123", "correct-token");
      expect(result).toBeNull();
    });
  });

  describe("isValidWebhookPayload", () => {
    it("should accept valid payload", () => {
      const payload: WhatsAppWebhookPayload = {
        object: "whatsapp_business_account",
        entry: [{ id: "123", changes: [] }],
      };
      expect(isValidWebhookPayload(payload)).toBe(true);
    });

    it("should reject invalid object", () => {
      const payload = { object: "invalid", entry: [] };
      expect(isValidWebhookPayload(payload)).toBe(false);
    });

    it("should reject empty entry", () => {
      const payload = { object: "whatsapp_business_account", entry: [] };
      expect(isValidWebhookPayload(payload)).toBe(false);
    });

    it("should reject null", () => {
      expect(isValidWebhookPayload(null)).toBe(false);
    });
  });
});

describe("WhatsApp Parser", () => {
  describe("parseWhatsAppPayload", () => {
    it("should parse text message", () => {
      const payload: WhatsAppWebhookPayload = {
        object: "whatsapp_business_account",
        entry: [{
          id: "123",
          changes: [{
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: {
                display_phone_number: "1234567890",
                phone_number_id: "phone-123",
              },
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

      const result = parseWhatsAppPayload(payload);
      expect(result).toHaveLength(1);
      expect(result[0].text).toBe("Hello");
      expect(result[0].senderPhone).toBe("1234567890");
      expect(result[0].externalMessageId).toBe("wamid-123");
      expect(result[0].phoneNumberId).toBe("phone-123");
    });

    it("should ignore unsupported message types", () => {
      const payload: WhatsAppWebhookPayload = {
        object: "whatsapp_business_account",
        entry: [{
          id: "123",
          changes: [{
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: {
                display_phone_number: "1234567890",
                phone_number_id: "phone-123",
              },
              messages: [{
                from: "1234567890",
                id: "wamid-123",
                timestamp: "1700000000",
                type: "image",
                image: { id: "img-123", mime_type: "image/jpeg" },
              }],
            },
          }],
        }],
      };

      const result = parseWhatsAppPayload(payload);
      expect(result).toHaveLength(0);
    });

    it("should handle empty messages", () => {
      const payload: WhatsAppWebhookPayload = {
        object: "whatsapp_business_account",
        entry: [{
          id: "123",
          changes: [{
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: {
                display_phone_number: "1234567890",
                phone_number_id: "phone-123",
              },
              messages: [],
            },
          }],
        }],
      };

      const result = parseWhatsAppPayload(payload);
      expect(result).toHaveLength(0);
    });

    it("should reject invalid object type", () => {
      const payload = {
        object: "invalid",
        entry: [],
      };

      const result = parseWhatsAppPayload(payload as unknown as WhatsAppWebhookPayload);
      expect(result).toHaveLength(0);
    });
  });

  describe("isSupportedMessage", () => {
    it("should support text messages", () => {
      const message: WhatsAppMessage = {
        from: "123",
        id: "wamid-123",
        timestamp: "1700000000",
        type: "text",
        text: { body: "Hello" },
      };
      expect(isSupportedMessage(message)).toBe(true);
    });

    it("should not support image messages", () => {
      const message: WhatsAppMessage = {
        from: "123",
        id: "wamid-123",
        timestamp: "1700000000",
        type: "image",
        image: { id: "img-123", mime_type: "image/jpeg" },
      };
      expect(isSupportedMessage(message)).toBe(false);
    });

    it("should not support audio messages", () => {
      const message: WhatsAppMessage = {
        from: "123",
        id: "wamid-123",
        timestamp: "1700000000",
        type: "audio",
        audio: { id: "audio-123", mime_type: "audio/mpeg" },
      };
      expect(isSupportedMessage(message)).toBe(false);
    });
  });
});
