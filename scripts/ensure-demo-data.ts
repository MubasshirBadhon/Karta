import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

/**
 * Ensure demo data exists for the investor demo.
 * This script is idempotent - safe to run multiple times.
 *
 * Usage: npx tsx scripts/ensure-demo-data.ts
 */

async function main() {
  console.log("Ensuring demo data exists...\n");

  // Create demo tenant
  const tenant = await prisma.tenant.upsert({
    where: { slug: "karta-demo-store" },
    update: {},
    create: {
      name: "Karta Demo Store",
      slug: "karta-demo-store",
    },
  });

  console.log(`✓ Tenant: ${tenant.name} (${tenant.id})`);

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
      description: "A classic black watch with leather strap. Water resistant up to 50m.",
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
      description: "Premium silver chronograph with sapphire crystal glass.",
      price: 4500,
      compareAtPrice: null,
      stock: 8,
      image: null,
      status: "active",
    },
    {
      externalId: "wc-003",
      sku: "WATCH-GOLD-003",
      name: "Gold Luxury Watch",
      slug: "gold-luxury-watch",
      description: "Luxury gold-plated watch with genuine leather strap.",
      price: 8500,
      compareAtPrice: 10000,
      stock: 3,
      image: null,
      status: "active",
    },
    {
      externalId: "wc-004",
      sku: "SHOE-RUN-001",
      name: "Running Shoes",
      slug: "running-shoes",
      description: "Lightweight running shoes with cushioned sole.",
      price: 3500,
      compareAtPrice: 4000,
      stock: 25,
      image: null,
      status: "active",
    },
    {
      externalId: "wc-005",
      sku: "SHOE-CAS-002",
      name: "Casual Sneakers",
      slug: "casual-sneakers",
      description: "Comfortable casual sneakers for everyday wear.",
      price: 2000,
      compareAtPrice: null,
      stock: 30,
      image: null,
      status: "active",
    },
  ];

  for (const product of products) {
    await prisma.product.upsert({
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
        ...product,
      },
    });

    console.log(`✓ Product: ${product.name} (${product.sku})`);
  }

  // Create variants for the first watch
  const watch = await prisma.product.findFirst({
    where: {
      tenantId: tenant.id,
      slug: "classic-black-watch",
    },
  });

  if (watch) {
    const variants = [
      {
        externalId: "wc-001-v1",
        sku: "WATCH-BLK-001-STRP-BRN",
        name: "Black / Brown Strap",
        attributes: { color: "Black", strap: "Brown" },
        price: 2500,
        stock: 10,
      },
      {
        externalId: "wc-001-v2",
        sku: "WATCH-BLK-001-STRP-BLK",
        name: "Black / Black Strap",
        attributes: { color: "Black", strap: "Black" },
        price: 2500,
        stock: 5,
      },
    ];

    for (const variant of variants) {
      await prisma.productVariant.upsert({
        where: {
          productId_externalId: {
            productId: watch.id,
            externalId: variant.externalId,
          },
        },
        update: {
          name: variant.name,
          sku: variant.sku,
          attributes: variant.attributes,
          price: variant.price,
          stock: variant.stock,
        },
        create: {
          productId: watch.id,
          ...variant,
        },
      });

      console.log(`✓ Variant: ${variant.name}`);
    }
  }

  console.log("\n✓ Demo data setup complete!");
  console.log(`  Tenant ID: ${tenant.id}`);
  console.log(`  Products: ${products.length}`);
}

main()
  .catch((e) => {
    console.error("Error:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
