import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

/**
 * Demo seed script for local development and investor demo preparation.
 *
 * Creates:
 * - One demo tenant
 * - Several realistic products with variants
 * - Stock and prices
 *
 * This is ONLY for development/demo environments.
 * Do NOT run this against a production WooCommerce tenant.
 *
 * Usage: npx tsx prisma/seed.ts
 */

async function main() {
  console.log("Seeding demo data...");

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
      sku: "TSHIRT-BLK-L",
      name: "Classic Black T-Shirt",
      slug: "classic-black-t-shirt",
      description: "A classic black t-shirt made from 100% cotton. Perfect for everyday wear.",
      price: 1500,
      compareAtPrice: 2000,
      stock: 50,
      image: null,
      status: "active",
      variants: [
        { externalId: "wc-001-v1", sku: "TSHIRT-BLK-S", name: "Black / S", attributes: { color: "Black", size: "S" }, price: 1500, stock: 15 },
        { externalId: "wc-001-v2", sku: "TSHIRT-BLK-M", name: "Black / M", attributes: { color: "Black", size: "M" }, price: 1500, stock: 20 },
        { externalId: "wc-001-v3", sku: "TSHIRT-BLK-L", name: "Black / L", attributes: { color: "Black", size: "L" }, price: 1500, stock: 10 },
        { externalId: "wc-001-v4", sku: "TSHIRT-BLK-XL", name: "Black / XL", attributes: { color: "Black", size: "XL" }, price: 1500, stock: 5 },
      ],
    },
    {
      externalId: "wc-002",
      sku: "SHOE-RUN-42",
      name: "Running Shoes",
      slug: "running-shoes",
      description: "Lightweight running shoes with excellent cushioning. Ideal for daily training.",
      price: 4500,
      compareAtPrice: 5500,
      stock: 30,
      image: null,
      status: "active",
      variants: [
        { externalId: "wc-002-v1", sku: "SHOE-RUN-40", name: "Black / 40", attributes: { color: "Black", size: "40" }, price: 4500, stock: 8 },
        { externalId: "wc-002-v2", sku: "SHOE-RUN-41", name: "Black / 41", attributes: { color: "Black", size: "41" }, price: 4500, stock: 10 },
        { externalId: "wc-002-v3", sku: "SHOE-RUN-42", name: "Black / 42", attributes: { color: "Black", size: "42" }, price: 4500, stock: 7 },
        { externalId: "wc-002-v4", sku: "SHOE-RUN-43", name: "Black / 43", attributes: { color: "Black", size: "43" }, price: 4500, stock: 5 },
      ],
    },
    {
      externalId: "wc-003",
      sku: "JEANS-BLU-32",
      name: "Blue Denim Jeans",
      slug: "blue-denim-jeans",
      description: "Classic blue denim jeans with a modern fit. Durable and comfortable.",
      price: 2800,
      compareAtPrice: null,
      stock: 25,
      image: null,
      status: "active",
      variants: [
        { externalId: "wc-003-v1", sku: "JEANS-BLU-30", name: "Blue / 30", attributes: { color: "Blue", size: "30" }, price: 2800, stock: 8 },
        { externalId: "wc-003-v2", sku: "JEANS-BLU-32", name: "Blue / 32", attributes: { color: "Blue", size: "32" }, price: 2800, stock: 10 },
        { externalId: "wc-003-v3", sku: "JEANS-BLU-34", name: "Blue / 34", attributes: { color: "Blue", size: "34" }, price: 2800, stock: 7 },
      ],
    },
  ];

  for (const productData of products) {
    const { variants, ...product } = productData;

    const existing = await prisma.product.findUnique({
      where: {
        tenantId_externalId: {
          tenantId: tenant.id,
          externalId: product.externalId,
        },
      },
    });

    if (existing) {
      console.log(`Product already exists: ${product.name}`);
      continue;
    }

    const newProduct = await prisma.product.create({
      data: {
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

    for (const variant of variants) {
      await prisma.productVariant.create({
        data: {
          productId: newProduct.id,
          externalId: variant.externalId,
          sku: variant.sku,
          name: variant.name,
          attributes: variant.attributes,
          price: variant.price,
          stock: variant.stock,
        },
      });
    }

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
