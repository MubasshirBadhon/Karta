import type { WhatsAppWebhookPayload, ParsedWhatsAppMessage, WhatsAppMessage } from "./types";

export type { ParsedWhatsAppMessage } from "./types";

/**
 * WhatsApp Message Parser
 *
 * Converts WhatsApp webhook payloads into a normalized format.
 * Only text messages are supported; other types are safely ignored.
 */

/**
 * Parse a WhatsApp webhook payload and extract text messages.
 * Returns an empty array for unsupported message types.
 */
export function parseWhatsAppPayload(payload: WhatsAppWebhookPayload): ParsedWhatsAppMessage[] {
  const messages: ParsedWhatsAppMessage[] = [];

  if (payload.object !== "whatsapp_business_account") {
    return messages;
  }

  for (const entry of payload.entry) {
    for (const change of entry.changes) {
      const value = change.value;
      const phoneNumberId = value.metadata.phone_number_id;

      if (!value.messages || value.messages.length === 0) {
        continue;
      }

      const contactName = value.contacts?.[0]?.profile?.name || "";

      for (const message of value.messages) {
        const parsed = parseSingleMessage(message, phoneNumberId, contactName);
        if (parsed) {
          messages.push(parsed);
        }
      }
    }
  }

  return messages;
}

/**
 * Parse a single WhatsApp message.
 * Returns null for unsupported message types.
 */
function parseSingleMessage(
  message: WhatsAppMessage,
  phoneNumberId: string,
  contactName: string
): ParsedWhatsAppMessage | null {
  // Only support text messages
  if (message.type !== "text" || !message.text) {
    return null;
  }

  return {
    externalMessageId: message.id,
    senderPhone: message.from,
    senderName: contactName,
    text: message.text.body,
    timestamp: new Date(parseInt(message.timestamp) * 1000).toISOString(),
    phoneNumberId,
    messageType: message.type,
  };
}

/**
 * Check if a WhatsApp message is a supported type.
 */
export function isSupportedMessage(message: WhatsAppMessage): boolean {
  return message.type === "text" && !!message.text;
}
