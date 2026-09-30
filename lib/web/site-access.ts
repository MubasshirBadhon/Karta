import { prisma } from "@/lib/db/prisma";

/**
 * Website Widget Access / Tenant Resolution
 *
 * Resolves the tenant for the website chat widget WITHOUT exposing the
 * WooCommerce connection secret.
 *
 * Chain of resolution:
 *   public siteToken (opaque widget identifier)
 *     → WooCommerceConnection (store)
 *     → tenant
 *     → products / conversations
 *
 * The public siteToken is the WooCommerce connection's `connectionId` —
 * a public, revocable identifier (NOT a secret, per docs/demo-setup.md).
 * The connection secret is used only for server-to-server HMAC
 * authentication and is never exposed to the browser.
 *
 * No global first-tenant fallback is used for the website widget.
 */

export interface WebsiteContext {
  tenantId: string;
  connectionId: string;
  siteUrl: string | null;
  siteName: string | null;
}

/**
 * Resolve the website context from a public site token.
 * Returns null for unknown tokens or disconnected stores.
 */
export async function resolveSiteTokenContext(siteToken: string): Promise<WebsiteContext | null> {
  if (!siteToken) return null;

  const connection = await prisma.wooCommerceConnection.findUnique({
    where: { connectionId: siteToken },
    select: {
      tenantId: true,
      connectionId: true,
      siteUrl: true,
      siteName: true,
      status: true,
    },
  });

  if (!connection || connection.status !== "active") {
    return null;
  }

  return {
    tenantId: connection.tenantId,
    connectionId: connection.connectionId,
    siteUrl: connection.siteUrl,
    siteName: connection.siteName,
  };
}

/**
 * Resolve the website context from an existing conversation ID.
 * Used for conversation continuation when the widget already has a
 * conversationId (the conversation itself proves tenant membership).
 *
 * Returns null if the conversation does not exist OR the tenant no longer
 * has an active WooCommerce connection — a disconnected store's products
 * must never leak through old conversations.
 */
export async function resolveConversationContext(conversationId: string): Promise<WebsiteContext | null> {
  if (!conversationId) return null;

  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: { tenantId: true, channel: true },
  });

  if (!conversation) {
    return null;
  }

  const connection = await prisma.wooCommerceConnection.findFirst({
    where: { tenantId: conversation.tenantId, status: "active" },
    select: {
      connectionId: true,
      siteUrl: true,
      siteName: true,
    },
  });

  // Disconnected store — do not expose its products
  if (!connection) {
    return null;
  }

  return {
    tenantId: conversation.tenantId,
    connectionId: connection.connectionId,
    siteUrl: connection.siteUrl,
    siteName: connection.siteName,
  };
}
