import { prisma } from "@/lib/db/prisma";

/**
 * Tenant Resolution
 *
 * Securely resolves the current tenant for the demo environment.
 * No client-supplied tenantId. No first-tenant fallback.
 *
 * For the investor demo, we use a deterministic tenant slug
 * that is configured server-side via environment variable.
 */

const DEMO_TENANT_SLUG = "karta-demo-store";

/**
 * Get or create the demo tenant.
 * This is idempotent - safe to call multiple times.
 */
export async function getOrCreateDemoTenant(): Promise<{
  id: string;
  name: string;
  slug: string;
} | null> {
  try {
    // Try to find existing demo tenant by slug
    const existing = await prisma.tenant.findUnique({
      where: { slug: DEMO_TENANT_SLUG },
    });

    if (existing) {
      return existing;
    }

    // Create demo tenant if it doesn't exist
    const tenant = await prisma.tenant.create({
      data: {
        name: "Karta Demo Store",
        slug: DEMO_TENANT_SLUG,
      },
    });

    return tenant;
  } catch (error) {
    console.error("Failed to resolve demo tenant:", error);
    return null;
  }
}

/**
 * Get the demo tenant ID.
 * Returns null if tenant doesn't exist.
 */
export async function getDemoTenantId(): Promise<string | null> {
  const tenant = await prisma.tenant.findUnique({
    where: { slug: DEMO_TENANT_SLUG },
    select: { id: true },
  });
  return tenant?.id || null;
}
