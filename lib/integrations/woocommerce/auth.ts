import { createHmac, timingSafeEqual } from "crypto";
import { prisma } from "@/lib/db/prisma";

/**
 * WooCommerce Integration Authentication
 *
 * Authenticates WordPress plugin requests using HMAC-SHA256 signatures.
 * Each connection has its own unique secret stored in the database.
 *
 * Security:
 * - The secret is never transmitted in the request body
 * - The signature is computed over connectionId + timestamp
 * - Timestamps are validated to prevent replay attacks
 * - The tenant is resolved from the connection, not from client input
 * - Each connection uses its own per-connection secret
 */

export interface AuthResult {
  success: boolean;
  tenantId?: string;
  connectionId?: string;
  error?: string;
}

/**
 * Authenticate a WordPress plugin request.
 *
 * Expected headers:
 * - X-Karta-Connection-Id: The unique connection identifier
 * - X-Karta-Timestamp: Unix timestamp of the request
 * - X-Karta-Signature: HMAC-SHA256 of "connectionId + timestamp" using the connection's secret
 */
export async function authenticateWordPressRequest(
  connectionId: string | null,
  timestamp: string | null,
  signature: string | null
): Promise<AuthResult> {
  if (!connectionId || !timestamp || !signature) {
    return { success: false, error: "Missing authentication headers" };
  }

  // Validate timestamp (prevent replay attacks)
  const requestTime = parseInt(timestamp, 10);
  if (isNaN(requestTime)) {
    return { success: false, error: "Invalid timestamp" };
  }

  const now = Math.floor(Date.now() / 1000);
  const maxAge = 300; // 5 minutes

  if (Math.abs(now - requestTime) > maxAge) {
    return { success: false, error: "Request timestamp too old" };
  }

  // Look up the connection
  const connection = await prisma.wooCommerceConnection.findUnique({
    where: { connectionId },
  });

  if (!connection) {
    return { success: false, error: "Invalid connection" };
  }

  if (connection.status !== "active") {
    return { success: false, error: "Connection is not active" };
  }

  // Verify the signature using the per-connection secret
  const secret = connection.connectionSecret;
  if (!secret) {
    return { success: false, error: "Connection secret not configured" };
  }

  const expectedSignature = createHmac("sha256", secret)
    .update(connectionId + timestamp)
    .digest("hex");

  const signatureBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expectedSignature);

  if (signatureBuffer.length !== expectedBuffer.length) {
    return { success: false, error: "Invalid signature" };
  }

  if (!timingSafeEqual(signatureBuffer, expectedBuffer)) {
    return { success: false, error: "Invalid signature" };
  }

  return {
    success: true,
    tenantId: connection.tenantId,
    connectionId: connection.connectionId,
  };
}

/**
 * Generate authentication headers for testing.
 * Used by tests only — never expose this in production code paths.
 */
export function generateAuthHeaders(
  connectionId: string,
  secret: string
): Record<string, string> {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = createHmac("sha256", secret)
    .update(connectionId + timestamp)
    .digest("hex");

  return {
    "X-Karta-Connection-Id": connectionId,
    "X-Karta-Timestamp": timestamp,
    "X-Karta-Signature": signature,
  };
}
