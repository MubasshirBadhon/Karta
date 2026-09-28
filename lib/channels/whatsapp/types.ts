/**
 * WhatsApp Channel Types
 *
 * Types specific to the WhatsApp Cloud API integration.
 * These are separate from the unified channel abstraction.
 */

export interface WhatsAppConfig {
  accessToken: string;
  phoneNumberId: string;
  businessAccountId?: string;
  apiVersion: string;
  verifyToken: string;
}

export interface WhatsAppWebhookPayload {
  object: string;
  entry: WhatsAppEntry[];
}

export interface WhatsAppEntry {
  id: string;
  changes: WhatsAppChange[];
}

export interface WhatsAppChange {
  value: WhatsAppValue;
  field: string;
}

export interface WhatsAppValue {
  messaging_product: string;
  metadata: WhatsAppMetadata;
  contacts?: WhatsAppContact[];
  messages?: WhatsAppMessage[];
  statuses?: WhatsAppStatus[];
}

export interface WhatsAppMetadata {
  display_phone_number: string;
  phone_number_id: string;
}

export interface WhatsAppContact {
  profile: {
    name: string;
  };
  wa_id: string;
}

export interface WhatsAppMessage {
  from: string;
  id: string;
  timestamp: string;
  type: string;
  text?: {
    body: string;
  };
  image?: {
    id: string;
    mime_type: string;
  };
  audio?: {
    id: string;
    mime_type: string;
  };
  video?: {
    id: string;
    mime_type: string;
  };
  sticker?: {
    id: string;
    mime_type: string;
  };
  reaction?: {
    message_id: string;
    emoji: string;
  };
}

export interface WhatsAppStatus {
  id: string;
  status: string;
  timestamp: string;
  recipient_id: string;
}

export interface WhatsAppSendMessageRequest {
  messaging_product: string;
  to: string;
  type: string;
  text: {
    body: string;
  };
}

export interface WhatsAppSendMessageResponse {
  messaging_product: string;
  contacts: Array<{ input: string; wa_id: string }>;
  messages: Array<{ id: string }>;
}

export interface ParsedWhatsAppMessage {
  externalMessageId: string;
  senderPhone: string;
  senderName: string;
  text: string;
  timestamp: string;
  phoneNumberId: string;
  messageType: string;
}
