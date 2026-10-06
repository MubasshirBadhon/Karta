import type { WhatsAppConfig, WhatsAppSendMessageRequest, WhatsAppSendMessageResponse } from "./types";
import { OpenWAProvider } from "./openwa/provider";

/**
 * WhatsApp Provider
 *
 * Server-side WhatsApp Cloud API client.
 * Handles sending messages through the official WhatsApp Business API.
 *
 * SECURITY: This module is ONLY imported server-side.
 * WhatsApp credentials are never exposed to browser code.
 */

export interface WhatsAppProvider {
  sendTextMessage(input: {
    phoneNumberId: string;
    recipientPhone: string;
    text: string;
    /** Optional explicit chat ID (used by the OpenWA transport; ignored by Meta) */
    chatId?: string;
  }): Promise<{ externalMessageId: string }>;
}

export class WhatsAppCloudProvider implements WhatsAppProvider {
  private accessToken: string;
  private apiVersion: string;
  private baseUrl: string;

  constructor(config: WhatsAppConfig) {
    this.accessToken = config.accessToken;
    this.apiVersion = config.apiVersion;
    this.baseUrl = `https://graph.facebook.com/${this.apiVersion}`;
  }

  async sendTextMessage(input: {
    phoneNumberId: string;
    recipientPhone: string;
    text: string;
  }): Promise<{ externalMessageId: string }> {
    const url = `${this.baseUrl}/${input.phoneNumberId}/messages`;

    const body: WhatsAppSendMessageRequest = {
      messaging_product: "whatsapp",
      to: input.recipientPhone,
      type: "text",
      text: {
        body: input.text,
      },
    };

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.accessToken}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `WhatsApp API error (${response.status}): ${errorText}`
      );
    }

    const data: WhatsAppSendMessageResponse = await response.json();

    const messageId = data.messages?.[0]?.id;
    if (!messageId) {
      throw new Error("WhatsApp API returned no message ID");
    }

    return { externalMessageId: messageId };
  }
}

/**
 * Get the configured WhatsApp provider.
 * Selected via WHATSAPP_PROVIDER: "openwa" | "meta" (default: "meta").
 *
 * SECURITY: credentials are read from server-side environment variables
 * only — never exposed to browser code, the WordPress plugin, customers,
 * or any API response.
 */
export function getWhatsAppProvider(): WhatsAppProvider {
  const provider = process.env.WHATSAPP_PROVIDER || "meta";

  switch (provider) {
    case "openwa": {
      // OpenWA transport (local OpenWA instance) — the Meta credentials
      // are NOT required in this mode.
      const baseUrl = process.env.OPENWA_BASE_URL;
      const apiKey = process.env.OPENWA_API_KEY;
      const sessionId = process.env.OPENWA_SESSION_ID;

      if (!baseUrl || !apiKey || !sessionId) {
        throw new Error("OpenWA is not configured: OPENWA_BASE_URL, OPENWA_API_KEY and OPENWA_SESSION_ID are required");
      }

      return new OpenWAProvider({ baseUrl, apiKey, sessionId });
    }
    case "meta":
    default: {
      // The existing Meta Cloud provider — completely unchanged.
      const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
      const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
      const businessAccountId = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID;
      const apiVersion = process.env.WHATSAPP_API_VERSION || "v18.0";
      const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN;

      if (!accessToken) {
        throw new Error("WHATSAPP_ACCESS_TOKEN is not set");
      }
      if (!phoneNumberId) {
        throw new Error("WHATSAPP_PHONE_NUMBER_ID is not set");
      }
      if (!verifyToken) {
        throw new Error("WHATSAPP_VERIFY_TOKEN is not set");
      }

      return new WhatsAppCloudProvider({
        accessToken,
        phoneNumberId,
        businessAccountId,
        apiVersion,
        verifyToken,
      });
    }
  }
}
