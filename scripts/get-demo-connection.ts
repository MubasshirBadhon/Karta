import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

/**
 * Get the demo connection ID for the Karta Demo Store.
 * This script outputs the connectionId to use as NEXT_PUBLIC_DEMO_SITE_TOKEN.
 *
 * Usage: npx tsx scripts/get-demo-connection.ts
 */

async function main() {
  console.log("Finding Karta Demo Store connection...\n");

  // Find the demo tenant
  const tenant = await prisma.tenant.findUnique({
    where: { slug: "karta-demo-store" },
  });

  if (!tenant) {
    console.error("Error: Karta Demo Store tenant not found");
    process.exit(1);
  }

  console.log("Tenant found:");
  console.log("  ID:", tenant.id);
  console.log("  Name:", tenant.name);
  console.log("  Slug:", tenant.slug);

  // Find the connection for this tenant
  const connection = await prisma.wooCommerceConnection.findFirst({
    where: { tenantId: tenant.id },
  });

  if (!connection) {
    console.error("Error: No WooCommerce connection found for this tenant");
    process.exit(1);
  }

  console.log("\nConnection found:");
  console.log("  ID:", connection.id);
  console.log("  Site URL:", connection.siteUrl);
  console.log("  Status:", connection.status);
  console.log("\n" + "=".repeat(60));
  console.log("NEXT_PUBLIC_DEMO_SITE_TOKEN=" + connection.connectionId);
  console.log("=".repeat(60));
  console.log("\nSet this value in Render as NEXT_PUBLIC_DEMO_SITE_TOKEN");
}

main()
  .catch((e) => {
    console.error("Error:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
