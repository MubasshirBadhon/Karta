import { createHmac, timingSafeEqual } from "crypto";
import type { WhatsAppWebhookPayload } from "./types";

/**
 * WhatsApp Webhook Handler
 *
 * Handles webhook verification and signature validation.
 * Uses the WhatsApp app secret for HMAC-SHA256 signature verification.
 */

/**
 * Verify WhatsApp webhook signature.
 * WhatsApp sends the signature in the X-Hub-Signature-256 header.
 */
export function verifyWebhookSignature(
  payload: string,
  signature: string,
  appSecret: string
): boolean {
  const expectedSignature = createHmac("sha256", appSecret)
    .update(payload)
    .digest("hex");

  const signatureBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expectedSignature);

  if (signatureBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return timingSafeEqual(signatureBuffer, expectedBuffer);
}

/**
 * Validate webhook verification request.
 * Returns the challenge if the token matches, null otherwise.
 */
export function validateVerificationRequest(
  mode: string,
  token: string,
  challenge: string,
  expectedToken: string
): string | null {
  if (mode === "subscribe" && token === expectedToken) {
    return challenge;
  }
  return null;
}

/**
 * Validate incoming webhook payload structure.
 */
export function isValidWebhookPayload(payload: unknown): payload is WhatsAppWebhookPayload {
  if (!payload || typeof payload !== "object") {
    return false;
  }
  const p = payload as WhatsAppWebhookPayload;
  return (
    p.object === "whatsapp_business_account" &&
    Array.isArray(p.entry) &&
    p.entry.length > 0
  );
}
