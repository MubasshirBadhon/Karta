import { prisma } from "@/lib/db/prisma";
import { getOrCreateDemoTenant } from "@/lib/tenant/resolution";
import { ChatClient } from "./chat-client";

export const dynamic = "force-dynamic";

/**
 * Demo chat page.
 *
 * Resolves the demo tenant's WooCommerce connection server-side and passes
 * only the public site token (the connection's public identifier, NOT the
 * secret) to the client widget. The /api/chat endpoint requires the site
 * token to resolve the tenant — no first-tenant fallback.
 */
export default async function DemoChatPage() {
  const tenant = await getOrCreateDemoTenant();

  const connection = tenant
    ? await prisma.wooCommerceConnection.findFirst({
        where: { tenantId: tenant.id, status: "active" },
        select: { connectionId: true },
      })
    : null;

  return <ChatClient siteToken={connection?.connectionId ?? ""} />;
}
