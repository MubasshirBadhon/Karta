/**
 * Channel Abstraction
 *
 * Unified message structure that normalizes messages from any channel
 * (web, WhatsApp, etc.) into a common format. The AI engine receives
 * UnifiedMessage regardless of the original channel.
 */

export type Channel = "web" | "whatsapp";

export interface UnifiedMessage {
  tenantId: string;
  channel: Channel;
  conversationId?: string;
  externalMessageId?: string;
  customerId?: string;
  text: string;
  timestamp: string;
}

/**
 * Channel adapter interface — each channel implements this to convert
 * its native message format to UnifiedMessage.
 */
export interface ChannelAdapter<TNativeMessage> {
  channel: Channel;
  parseMessage(raw: TNativeMessage): UnifiedMessage;
}

/**
 * Helper to create a UnifiedMessage with defaults.
 */
export function createUnifiedMessage(params: {
  tenantId: string;
  channel: Channel;
  text: string;
  conversationId?: string;
  externalMessageId?: string;
  customerId?: string;
  timestamp?: string;
}): UnifiedMessage {
  return {
    tenantId: params.tenantId,
    channel: params.channel,
    text: params.text,
    conversationId: params.conversationId,
    externalMessageId: params.externalMessageId,
    customerId: params.customerId,
    timestamp: params.timestamp || new Date().toISOString(),
  };
}
