import { PrismaClient } from "@prisma/client";
import { randomBytes } from "crypto";

const prisma = new PrismaClient();

/**
 * Setup script for Karta Demo Store connection.
 * Creates a WooCommerceConnection record for the demo store if it doesn't exist.
 * Outputs the connectionId to use as NEXT_PUBLIC_DEMO_SITE_TOKEN.
 */

function generateConnectionId(): string {
  return `kwc_${randomBytes(16).toString("hex")}`;
}

function generateConnectionSecret(): string {
  return randomBytes(32).toString("hex");
}

async function main() {
  console.log("Setting up Karta Demo Store connection...\n");

  // Get or create the demo tenant
  let tenant = await prisma.tenant.findUnique({
    where: { slug: "karta-demo-store" },
  });

  if (!tenant) {
    console.log("Creating demo tenant...");
    tenant = await prisma.tenant.create({
      data: {
        name: "Karta Demo Store",
        slug: "karta-demo-store",
      },
    });
    console.log(`Created tenant: ${tenant.name} (${tenant.id})`);
  } else {
    console.log(`Found tenant: ${tenant.name} (${tenant.id})`);
  }

  // Check if connection already exists
  let connection = await prisma.wooCommerceConnection.findFirst({
    where: { tenantId: tenant.id },
  });

  if (!connection) {
    console.log("\nCreating WooCommerce connection...");
    connection = await prisma.wooCommerceConnection.create({
      data: {
        tenantId: tenant.id,
        siteUrl: "https://bd-deals.unaux.com",
        siteName: "Karta Demo Store",
        connectionId: generateConnectionId(),
        connectionSecret: generateConnectionSecret(),
        status: "active",
      },
    });
    console.log("Created connection successfully!");
  } else {
    console.log("\nConnection already exists.");
  }

  console.log("\n" + "=".repeat(60));
  console.log("DEMO SITE TOKEN CONFIGURATION");
  console.log("=".repeat(60));
  console.log("\nSet this environment variable in Render:");
  console.log(`\nNEXT_PUBLIC_DEMO_SITE_TOKEN=${connection.connectionId}\n`);
  console.log("=".repeat(60));
}

main()
  .catch((e) => {
    console.error("Error:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
