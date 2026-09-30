import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { authenticateWordPressRequest } from "@/lib/integrations/woocommerce/auth";
import { validateSyncRequest } from "@/lib/integrations/woocommerce/normalizer";
import { syncProducts, softDeleteProduct } from "@/lib/integrations/woocommerce/sync";

export async function POST(request: Request) {
  try {
    // Authenticate the request
    const connectionId = request.headers.get("X-Karta-Connection-Id");
    const timestamp = request.headers.get("X-Karta-Timestamp");
    const signature = request.headers.get("X-Karta-Signature");

    const auth = await authenticateWordPressRequest(connectionId, timestamp, signature);

    if (!auth.success) {
      return NextResponse.json(
        { error: auth.error },
        { status: 401 }
      );
    }

    // Parse the webhook payload
    const body = await request.json();
    const eventType = body.eventType || body.topic;
    const externalEventId = body.externalEventId || body.id;

    // Check for duplicate webhook delivery
    if (externalEventId) {
      const existing = await prisma.webhookEvent.findUnique({
        where: {
          connectionId_externalEventId: {
            connectionId: auth.connectionId!,
            externalEventId: externalEventId,
          },
        },
      });

      if (existing) {
        return NextResponse.json({ success: true, duplicate: true });
      }
    }

    // Store the webhook event
    await prisma.webhookEvent.create({
      data: {
        connectionId: auth.connectionId!,
        eventType,
        externalEventId: externalEventId || null,
        payload: body,
        status: "processed",
        processedAt: new Date(),
      },
    });

    // Process based on event type
    if (eventType === "product.deleted") {
      const productId = body.productId || body.id;
      // Archive (never hard-delete) the product, scoped to this Woo
      // connection so one connection's webhook never archives another
      // connection's product.
      if (productId) {
        await softDeleteProduct(auth.tenantId!, auth.connectionId!, String(productId));
      }
    } else if (eventType === "product.created" || eventType === "product.updated") {
      const product = body.product;
      if (product) {
        const validation = validateSyncRequest({ products: [product] });
        if (validation.success) {
          await syncProducts(auth.tenantId!, auth.connectionId!, validation.products!);
        }
      }
    }

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
