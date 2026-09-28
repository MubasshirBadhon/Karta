import type { WhatsAppConfig, WhatsAppSendMessageRequest, WhatsAppSendMessageResponse } from "./types";

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
 * Reads credentials from server-side environment variables only.
 */
export function getWhatsAppProvider(): WhatsAppProvider {
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
