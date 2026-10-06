/**
 * OpenWA Channel Types
 *
 * Types for the OpenWA WhatsApp transport (wa-automate style, v0.24.0).
 * ADDITIVE to the existing Meta Cloud API types — the Meta provider is
 * untouched.
 */

export interface OpenWAWebhookEvent {
  event: string; // e.g. "message.received"
  timestamp: string | number;
  sessionId: string;
  idempotencyKey: string;
  deliveryId?: string;
  data: OpenWAEventData;
}

export interface OpenWAEventData {
  id: string;
  from: string; // the sender/author
  to: string;
  chatId: string; // the chat to reply to (e.g. "8801XXXXXXXXX@c.us")
  body?: string; // the message text (present for type "chat")
  type: string; // "chat" for text messages
  timestamp: string | number; // seconds or milliseconds
  fromMe: boolean; // true for the session's own outgoing messages
  isGroup: boolean;
  kind?: string;
}

export interface OpenWAConfig {
  baseUrl: string;
  apiKey: string;
  sessionId: string;
}

export interface OpenWASendTextRequest {
  chatId: string;
  text: string;
}

export interface OpenWASendTextResponse {
  id?: string;
  sent?: boolean;
  [key: string]: unknown;
}
