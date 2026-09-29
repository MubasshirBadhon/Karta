import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

/**
 * Find the existing WooCommerceConnection for the demo store.
 * This script should be run on Render to get the connectionId.
 *
 * Usage: npx tsx scripts/find-demo-connection.ts
 */

async function main() {
  console.log("Finding existing WooCommerce connections...\n");

  const connections = await prisma.wooCommerceConnection.findMany({
    include: {
      tenant: true,
    },
  });

  console.log(`Found ${connections.length} connection(s):\n`);

  for (const conn of connections) {
    console.log("Connection ID:", conn.connectionId);
    console.log("Tenant ID:", conn.tenantId);
    console.log("Tenant Name:", conn.tenant.name);
    console.log("Site URL:", conn.siteUrl);
    console.log("Status:", conn.status);
    console.log("---");
  }

  // Find the one for bd-deals.unaux.com
  const demoConnection = connections.find(
    (c) => c.siteUrl === "https://bd-deals.unaux.com"
  );

  if (demoConnection) {
    console.log("\n=== DEMO STORE CONNECTION ===");
    console.log("Connection ID:", demoConnection.connectionId);
    console.log("Tenant:", demoConnection.tenant.name);
    console.log("\nUse this connectionId as NEXT_PUBLIC_DEMO_SITE_TOKEN in Render");
  } else {
    console.log("\nNo connection found for https://bd-deals.unaux.com");
    console.log("Available connections:");
    connections.forEach((c) => {
      console.log(`  - ${c.siteUrl} (${c.connectionId})`);
    });
  }
}

main()
  .catch((e) => {
    console.error("Error:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
