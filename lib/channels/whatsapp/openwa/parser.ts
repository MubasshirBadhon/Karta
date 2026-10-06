import type { ParsedWhatsAppMessage } from "../types";
import type { OpenWAWebhookEvent, OpenWAEventData } from "./types";

export type { ParsedWhatsAppMessage } from "../types";

/**
 * OpenWA Message Parser
 *
 * Converts OpenWA `message.received` webhook events into the EXISTING
 * unified ParsedWhatsAppMessage format so the shared adapter/AI engine is
 * reused untouched — OpenWA is only a transport adapter.
 *
 * Rules:
 * - Only `message.received` events are handled; everything else is ignored.
 * - `fromMe=true` events are IGNORED (loop prevention: the session's own
 *   outgoing messages must never re-enter the AI pipeline).
 * - Group messages are ignored (the commerce assistant is 1:1).
 * - Only text messages (type "chat" with a body) are supported; other
 *   types are safely ignored.
 * - The `idempotencyKey` is used as the external message ID so OpenWA
 *   retries never create duplicate Karta messages or duplicate AI replies.
 */
export function parseOpenWAEvent(event: OpenWAWebhookEvent): ParsedWhatsAppMessage | null {
  if (event.event !== "message.received") {
    return null;
  }
  if (!event.data) {
    return null;
  }
  return parseOpenWAData(event.data, event.sessionId, event.idempotencyKey);
}

function parseOpenWAData(
  data: OpenWAEventData,
  sessionId: string,
  idempotencyKey: string
): ParsedWhatsAppMessage | null {
  // Loop prevention: never process the session's own outgoing messages
  if (data.fromMe) {
    return null;
  }

  // 1:1 chats only — group messages are ignored
  if (data.isGroup) {
    return null;
  }

  // Only text messages (OpenWA uses type "text" for chat text — verified
  // against the OpenWA engine's MessageType enum)
  if (data.type !== "text" || !data.body) {
    return null;
  }

  return {
    externalMessageId: idempotencyKey || data.id,
    senderPhone: data.from,
    senderName: "",
    text: data.body,
    timestamp: normalizeTimestamp(data.timestamp),
    // The OpenWA session identifies the connection (stored as the
    // WhatsAppConnection's phoneNumberId)
    phoneNumberId: sessionId,
    messageType: "text",
  };
}

/**
 * Normalize a timestamp (seconds or milliseconds) to an ISO string.
 */
function normalizeTimestamp(value: string | number): string {
  const num = typeof value === "number" ? value : parseInt(value, 10);
  if (Number.isNaN(num) || num <= 0) {
    return new Date().toISOString();
  }
  // Values below 1e12 are seconds; 1e12+ are milliseconds
  const ms = num < 1e12 ? num * 1000 : num;
  return new Date(ms).toISOString();
}

/**
 * Check whether an OpenWA event is a supported inbound text message.
 */
export function isSupportedOpenWAEvent(event: OpenWAWebhookEvent): boolean {
  return (
    event.event === "message.received" &&
    !!event.data &&
    !event.data.fromMe &&
    !event.data.isGroup &&
    event.data.type === "text" &&
    !!event.data.body
  );
}
