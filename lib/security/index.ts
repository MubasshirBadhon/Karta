/**
 * Security Module
 *
 * Centralized security utilities and constants for Karta.
 * All secrets are server-side only and never exposed to browser code.
 */

import { createHmac, timingSafeEqual } from "crypto";

// ─── Environment Variable Guards ─────────────────────────────

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Required environment variable ${name} is not set`);
  }
  return value;
}

export function getEnv(name: string, defaultValue?: string): string | undefined {
  return process.env[name] || defaultValue;
}

// ─── Tenant Isolation ─────────────────────────────────────────

/**
 * Validates that a tenant ID is present and non-empty.
 * Every commerce operation must be tenant-scoped.
 */
export function validateTenantId(tenantId: string | null | undefined): asserts tenantId is string {
  if (!tenantId || tenantId.trim() === "") {
    throw new Error("Tenant ID is required for this operation");
  }
}

// ─── Webhook Verification ─────────────────────────────────────

/**
 * Verifies WhatsApp webhook signature.
 * Uses HMAC-SHA256 to validate the payload authenticity.
 */
export function verifyWhatsAppSignature(
  payload: string,
  signature: string,
  appSecret: string
): boolean {
  const expectedSignature = createHmac("sha256", appSecret)
    .update(payload)
    .digest("hex");
  return timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expectedSignature)
  );
}

/**
 * Verifies WordPress webhook signature.
 */
export function verifyWordPressSignature(
  payload: string,
  signature: string,
  secret: string
): boolean {
  const expectedSignature = createHmac("sha256", secret)
    .update(payload)
    .digest("hex");
  return timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expectedSignature)
  );
}

// ─── Secret Redaction ─────────────────────────────────────────

/**
 * Redacts sensitive values from objects before logging.
 */
export function redactSecrets<T extends Record<string, unknown>>(
  obj: T,
  secretKeys: string[] = ["apiKey", "token", "secret", "password", "authorization"]
): T {
  const redacted = { ...obj };
  for (const key of Object.keys(redacted)) {
    if (secretKeys.some((sk) => key.toLowerCase().includes(sk.toLowerCase()))) {
      (redacted as Record<string, unknown>)[key] = "[REDACTED]";
    }
  }
  return redacted;
}

// ─── Security Constants ───────────────────────────────────────

export const SECURITY_RULES = {
  GROQ_API_KEY_SERVER_ONLY: true,
  WHATSAPP_CREDENTIALS_SERVER_ONLY: true,
  WORDPRESS_NEVER_RECEIVES_GROQ: true,
  TENANT_DATA_ISOLATED: true,
  WEBHOOKS_VERIFIED: true,
  CLIENT_PRICE_STOCK_UNTRUSTED: true,
  AI_CANNOT_INVENT_PRICES: true,
  AI_CANNOT_INVENT_STOCK: true,
  AI_CANNOT_INVENT_VARIANTS: true,
  AI_CANNOT_INVENT_DISCOUNTS: true,
  AI_CANNOT_INVENT_SPECS: true,
  SECRETS_NEVER_COMMITTED: true,
  CREDENTIALS_NOT_LOGGED: true,
} as const;
