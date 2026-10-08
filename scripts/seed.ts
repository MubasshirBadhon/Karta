import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

/**
 * Seed script for development/demo environment.
 * Creates a demo tenant with realistic products.
 */
async function main() {
  console.log("Seeding demo data...");

  // Create demo tenant
  const tenant = await prisma.tenant.upsert({
    where: { slug: "demo-store" },
    update: {},
    create: {
      name: "Demo Store",
      slug: "demo-store",
    },
  });

  console.log(`Created tenant: ${tenant.name} (${tenant.id})`);

  // Create demo products
  const products = [
    {
      externalId: "wc-001",
      sku: "TSHIRT-BLK-L",
      name: "Classic Black T-Shirt",
      slug: "classic-black-t-shirt",
      description: "A classic black t-shirt made from 100% cotton. Perfect for everyday wear.",
      price: 1500,
      compareAtPrice: 2000,
      stock: 50,
      image: null,
      status: "active",
    },
    {
      externalId: "wc-002",
      sku: "SHOE-RUN-42",
      name: "Running Shoes",
      slug: "running-shoes",
      description: "Lightweight running shoes with excellent cushioning.",
      price: 4500,
      compareAtPrice: null,
      stock: 30,
      image: null,
      status: "active",
    },
    {
      externalId: "wc-003",
      sku: "JEANS-BLU-32",
      name: "Blue Denim Jeans",
      slug: "blue-denim-jeans",
      description: "Classic blue denim jeans with a modern fit.",
      price: 2800,
      compareAtPrice: null,
      stock: 25,
      image: null,
      status: "active",
    },
  ];

  // Find or create the demo Woo connection (the identity scope for
  // seeded products: tenantId + wooConnectionId + externalId)
  let connection = await prisma.wooCommerceConnection.findFirst({
    where: { tenantId: tenant.id },
  });
  if (!connection) {
    connection = await prisma.wooCommerceConnection.create({
      data: {
        tenantId: tenant.id,
        siteUrl: "https://bd-deals.unaux.com",
        connectionId: "kwc_demo_seed",
        connectionSecret: "seed-only-not-used-for-production-auth",
        status: "active",
      },
    });
  }
  for (const product of products) {
    await prisma.product.upsert({
      where: {
        tenantId_wooConnectionId_externalId: {
          tenantId: tenant.id,
          wooConnectionId: connection.connectionId,
          externalId: product.externalId,
        },
      },
      update: {},
      create: {
        ...product,
        tenantId: tenant.id,
      },
    });
    console.log(`Created product: ${product.name}`);
  }

  console.log("Seed complete!");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
