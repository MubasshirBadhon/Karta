import { createHash } from "crypto";
import type { WhatsAppProvider } from "../provider";
import type { OpenWAConfig, OpenWASendTextRequest, OpenWASendTextResponse } from "./types";

/**
 * OpenWA WhatsApp Provider
 *
 * Transport implementation of the WhatsAppProvider interface using a
 * locally-running OpenWA instance (v0.24.0). ADDITIVE to the existing
 * Meta Cloud provider — the Meta provider is untouched.
 *
 * Outbound messages:
 *   POST {OPENWA_BASE_URL}/api/sessions/{OPENWA_SESSION_ID}/messages/send-text
 *   Header: X-API-Key: <OPENWA_API_KEY>
 *   Body:   { "chatId": "<customer chatId>", "text": "<reply>" }
 *
 * SECURITY: the API key is read from server-side environment variables
 * only — it is NEVER exposed to the browser, the WordPress plugin,
 * customers, or any API response.
 */
export class OpenWAProvider implements WhatsAppProvider {
  // TRUE private fields (ES2022 #private): the API key is not enumerable
  // and cannot leak through serialization/reflection.
  #apiKey: string;
  #baseUrl: string;
  #sessionId: string;

  constructor(config: OpenWAConfig) {
    this.#apiKey = config.apiKey;
    this.#baseUrl = config.baseUrl.replace(/\/+$/, "");
    this.#sessionId = config.sessionId;
  }

  /**
   * Send a text message to a customer's chat.
   *
   * The chatId is derived from the recipient phone (OpenWA's 1:1 chat ID
   * format "<number>@c.us") unless an explicit chatId is provided by the
   * caller (the inbound event's chatId).
   */
  async sendTextMessage(input: {
    phoneNumberId: string;
    recipientPhone: string;
    text: string;
    chatId?: string;
  }): Promise<{ externalMessageId: string }> {
    const chatId = input.chatId || chatIdFromPhone(input.recipientPhone);

    const body: OpenWASendTextRequest = {
      chatId,
      text: input.text,
    };

    const url = `${this.#baseUrl}/api/sessions/${this.#sessionId}/messages/send-text`;

    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": this.#apiKey,
        },
        body: JSON.stringify(body),
      });
    } catch (error) {
      // Structured log — never the API key or the message content
      console.error("[OPENWA] Send failed (network):", {
        operation: "send-text",
        chatIdHash: hash(chatId),
        error: error instanceof Error ? error.name : "Unknown error",
      });
      throw error;
    }

    if (!response.ok) {
      const errorText = await response.text();
      console.error("[OPENWA] Send failed:", {
        operation: "send-text",
        status: response.status,
        chatIdHash: hash(chatId),
        errorSnippet: errorText.slice(0, 120),
      });
      throw new Error(`OpenWA API error (${response.status})`);
    }

    const data: OpenWASendTextResponse = await response.json().catch(() => ({}));

    return { externalMessageId: String(data.id ?? `openwa_${Date.now()}`) };
  }
}

/**
 * Derive an OpenWA 1:1 chat ID from a phone number:
 * digits only + "@c.us".
 */
export function chatIdFromPhone(phone: string): string {
  const digits = String(phone || "").replace(/[^\d]/g, "");
  return `${digits}@c.us`;
}

function hash(value: string): string {
  // A short correlation hash — never the raw value
  return createHash("sha256").update(value).digest("hex").slice(0, 8);
}
