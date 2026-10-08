import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

/**
 * Seed script for Karta Demo Store.
 * Creates the demo tenant and sample products for the investor demo.
 *
 * Usage: npx tsx scripts/seed-demo.ts
 */

async function main() {
  console.log("Seeding Karta Demo Store...\n");

  // Create demo tenant
  const tenant = await prisma.tenant.upsert({
    where: { slug: "karta-demo-store" },
    update: {},
    create: {
      name: "Karta Demo Store",
      slug: "karta-demo-store",
    },
  });

  console.log(`Created tenant: ${tenant.name} (${tenant.id})`);

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
  const wooConnectionId = connection.connectionId;
  // Create demo products
  const products = [
    {
      externalId: "wc-001",
      sku: "WATCH-BLK-001",
      name: "Classic Black Watch",
      slug: "classic-black-watch",
      description: "A classic black watch with leather strap. Perfect for everyday wear.",
      price: 2500,
      compareAtPrice: 3000,
      stock: 15,
      image: null,
      status: "active",
    },
    {
      externalId: "wc-002",
      sku: "WATCH-SLV-002",
      name: "Silver Chronograph Watch",
      slug: "silver-chronograph-watch",
      description: "Premium silver chronograph watch with multiple dials.",
      price: 4500,
      compareAtPrice: 5500,
      stock: 8,
      image: null,
      status: "active",
    },
    {
      externalId: "wc-003",
      sku: "SHOE-RUN-001",
      name: "Running Shoes",
      slug: "running-shoes",
      description: "Lightweight running shoes with excellent cushioning.",
      price: 3500,
      compareAtPrice: null,
      stock: 25,
      image: null,
      status: "active",
    },
    {
      externalId: "wc-004",
      sku: "SHOE-CAS-002",
      name: "Casual Sneakers",
      slug: "casual-sneakers",
      description: "Comfortable casual sneakers for everyday use.",
      price: 2000,
      compareAtPrice: 2500,
      stock: 30,
      image: null,
      status: "active",
    },
    {
      externalId: "wc-005",
      sku: "BAG-LTH-001",
      name: "Leather Backpack",
      slug: "leather-backpack",
      description: "Genuine leather backpack with multiple compartments.",
      price: 5000,
      compareAtPrice: 6000,
      stock: 5,
      image: null,
      status: "active",
    },
  ];

  for (const product of products) {
    const created = await prisma.product.upsert({
      where: {
        tenantId_wooConnectionId_externalId: {
          tenantId: tenant.id,
          wooConnectionId,
          externalId: product.externalId,
        },
      },
      update: {
        name: product.name,
        slug: product.slug,
        description: product.description,
        price: product.price,
        compareAtPrice: product.compareAtPrice,
        stock: product.stock,
        image: product.image,
        status: product.status,
      },
      create: {
        tenantId: tenant.id,
        wooConnectionId,
        externalId: product.externalId,
        sku: product.sku,
        name: product.name,
        slug: product.slug,
        description: product.description,
        price: product.price,
        compareAtPrice: product.compareAtPrice,
        stock: product.stock,
        image: product.image,
        status: product.status,
      },
    });

    console.log(`Created product: ${created.name} (${created.sku})`);
  }

  console.log("\nSeed complete!");
  console.log(`Tenant ID: ${tenant.id}`);
  console.log(`Products: ${products.length}`);
}

main()
  .catch((e) => {
    console.error("Error:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
