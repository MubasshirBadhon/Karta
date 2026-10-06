import { randomBytes } from "crypto";
import { prisma } from "@/lib/db/prisma";

/**
 * WooCommerce Connection Provisioning
 *
 * Creates new WooCommerce connections with cryptographically secure
 * connection IDs and secrets. Each connection gets its own unique
 * secret for HMAC authentication.
 */

export interface ConnectionCredentials {
  connectionId: string;
  connectionSecret: string;
}

export interface ProvisionResult {
  success: boolean;
  connectionId?: string;
  connectionSecret?: string;
  siteUrl?: string;
  siteName?: string;
  error?: string;
}

/**
 * Generate a cryptographically secure connection ID.
 * Format: kwc_<32 hex characters>
 */
function generateConnectionId(): string {
  return `kwc_${randomBytes(16).toString("hex")}`;
}

/**
 * Generate a cryptographically secure connection secret.
 * 64 hex characters (256 bits of entropy).
 */
function generateConnectionSecret(): string {
  return randomBytes(32).toString("hex");
}

/**
 * Create a new WooCommerce connection for a tenant.
 * Generates unique connection ID and secret.
 */
export async function createWooCommerceConnection(
  tenantId: string,
  siteUrl: string,
  siteName?: string
): Promise<ProvisionResult> {
  try {
    // Validate inputs
    if (!tenantId || tenantId.trim() === "") {
      return { success: false, error: "Tenant ID is required" };
    }
    if (!siteUrl || siteUrl.trim() === "") {
      return { success: false, error: "Site URL is required" };
    }

    // Verify tenant exists
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
    });
    if (!tenant) {
      return { success: false, error: "Invalid tenant" };
    }

    // Multiple connections per tenant are supported — each store gets its
    // own connection credentials. No single-connection restriction.

    // Generate credentials
    const connectionId = generateConnectionId();
    const connectionSecret = generateConnectionSecret();

    // Create connection
    await prisma.wooCommerceConnection.create({
      data: {
        tenantId,
        siteUrl,
        siteName: siteName || null,
        connectionId,
        connectionSecret,
        status: "active",
      },
    });

    return {
      success: true,
      connectionId,
      connectionSecret,
      siteUrl,
      siteName,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Get connection by ID (without exposing secret).
 */
export async function getConnection(
  connectionId: string
): Promise<{
  id: string;
  tenantId: string;
  siteUrl: string;
  siteName: string | null;
  status: string;
  lastSyncAt: Date | null;
  createdAt: Date;
} | null> {
  const connection = await prisma.wooCommerceConnection.findUnique({
    where: { connectionId },
    select: {
      id: true,
      tenantId: true,
      siteUrl: true,
      siteName: true,
      status: true,
      lastSyncAt: true,
      createdAt: true,
    },
  });
  return connection;
}

/**
 * List connections for a tenant (without exposing secrets).
 */
export async function listConnections(tenantId: string) {
  return prisma.wooCommerceConnection.findMany({
    where: { tenantId },
    select: {
      id: true,
      connectionId: true,
      siteUrl: true,
      siteName: true,
      status: true,
      lastSyncAt: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
  });
}

/**
 * Disconnect a connection.
 */
export async function disconnectConnection(
  connectionId: string
): Promise<boolean> {
  const result = await prisma.wooCommerceConnection.updateMany({
    where: { connectionId },
    data: { status: "disconnected" },
  });
  return result.count > 0;
}
