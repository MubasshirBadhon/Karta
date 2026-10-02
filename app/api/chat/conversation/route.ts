import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { resolveSiteTokenContext } from "@/lib/web/site-access";
import { getCustomerProfile } from "@/lib/intelligence/profile";
import { recommend } from "@/lib/recommendations/engine";

/**
 * Website conversation persistence endpoints.
 *
 * GET /api/chat/conversation?visitorId=...&siteToken=...
 *   Loads the visitor's most recent conversation (server-side persisted)
 *   so the chat survives page navigation: the widget recovers the
 *   first-party visitor ID and restores messages + state from here.
 *
 *   - Tenant isolation: the siteToken resolves the connection → tenant;
 *     only conversations belonging to that tenant AND visitor are returned.
 *   - The visitorId is a first-party, cryptographically random identifier
 *     (never an IP address) — it acts as the visitor's own capability.
 *   - Returns an optional proactive suggestion (deterministic, from the
 *     recommendation engine) when the visitor has recent relevant interests.
 *
 * DELETE /api/chat/conversation (body: visitorId, siteToken)
 *   "Clear conversation": the current conversation is CLOSED (preserved
 *   for merchant analytics) and a NEW conversation starts.
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const visitorId = searchParams.get("visitorId") || "";
    const siteToken = searchParams.get("siteToken") || "";

    if (!visitorId || !siteToken) {
      return NextResponse.json(
        { error: "visitorId and siteToken are required" },
        { status: 400 }
      );
    }

    // Tenant resolution via the public site token
    const context = await resolveSiteTokenContext(siteToken);
    if (!context) {
      return NextResponse.json({ error: "Invalid site token" }, { status: 401 });
    }

    // Tenant + visitor isolated: only this visitor's conversations
    const conversation = await prisma.conversation.findFirst({
      where: {
        tenantId: context.tenantId,
        channel: "web",
        visitorId,
        status: "active",
      },
      orderBy: { updatedAt: "desc" },
      include: {
        messages: {
          orderBy: { createdAt: "asc" },
          take: 40,
          select: { role: true, content: true },
        },
      },
    });

    if (!conversation) {
      return NextResponse.json({
        success: true,
        conversationId: null,
        messages: [],
        metadata: null,
        suggestion: null,
      });
    }

    // Clean messages for the browser: [PRODUCT:id] markers are internal
    const messages = conversation.messages.map((m) => ({
      role: m.role === "assistant" ? "bot" : "user",
      content: m.content.replace(/\[PRODUCT:[^\]]+\]/g, "").trim(),
    }));

    const metadata = (conversation.metadata as Record<string, unknown>) || null;

    // Proactive suggestion (deterministic, explainable, optional):
    // based on the visitor's recent interests, complementary to what
    // they were last looking at.
    let suggestion: { message: string; product: Record<string, unknown> } | null = null;
    try {
      const profile = await getCustomerProfile(context.tenantId, { visitorId });
      if (profile.interestedCategories.length || profile.viewedProductIds.length) {
        const catalog = await prisma.product.findMany({
          where: { tenantId: context.tenantId, status: "active" },
          include: { variants: true },
          orderBy: { createdAt: "asc" },
        });
        const mappedCatalog = catalog.map((p) => ({
          id: p.id,
          externalId: p.externalId,
          name: p.name,
          description: p.description,
          price: Number(p.price),
          compareAtPrice: p.compareAtPrice ? Number(p.compareAtPrice) : null,
          stock: p.stock,
          stockStatus: p.stockStatus,
          manageStock: p.manageStock,
          status: p.status,
          image: p.image,
          productUrl: p.productUrl,
          sku: p.sku,
          category: p.category,
          variants: p.variants.map((v) => ({
            id: v.id,
            externalId: v.externalId,
            name: v.name,
            attributes: (v.attributes as Record<string, string>) || {},
            price: Number(v.price),
            stock: v.stock,
          })),
        }));

        const candidates = recommend({
          profile,
          currentProductId: ((metadata?.selectedProductId as string) ?? null),
          catalog: mappedCatalog,
          inventoryMode: context.inventoryMode,
          max: 1,
        });

        if (candidates.length > 0) {
          const rec = candidates[0];
          const interest = profile.interestedCategories[0];
          suggestion = {
            message: interest
              ? `Last time you were looking at ${interest.toLowerCase()}s. You might also like this one:`
              : `You might also like this one:`,
            product: {
              id: rec.product.id,
              externalId: rec.product.externalId,
              name: rec.product.name,
              price: Number(rec.product.price),
              compareAtPrice: rec.product.compareAtPrice ? Number(rec.product.compareAtPrice) : null,
              availability: rec.product.stock !== null && rec.product.stock <= 0 ? "Out of stock" : "Available",
              imageUrl: rec.product.image || null,
              productUrl: rec.product.productUrl || null,
              reason: rec.reason,
            },
          };
        }
      }
    } catch (error) {
      console.error("[CONVERSATION] Suggestion failed:", error);
    }

    return NextResponse.json({
      success: true,
      conversationId: conversation.id,
      messages,
      metadata: {
        selectedProductId: (metadata?.selectedProductId as string) ?? null,
        location: (metadata?.location as string) ?? null,
      },
      suggestion,
    });
  } catch (error) {
    console.error("[CONVERSATION] Load failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const body = await request.json().catch(() => null);
    const visitorId = typeof body?.visitorId === "string" ? body.visitorId : "";
    const siteToken = typeof body?.siteToken === "string" ? body.siteToken : "";

    if (!visitorId || !siteToken) {
      return NextResponse.json(
        { error: "visitorId and siteToken are required" },
        { status: 400 }
      );
    }

    const context = await resolveSiteTokenContext(siteToken);
    if (!context) {
      return NextResponse.json({ error: "Invalid site token" }, { status: 401 });
    }

    // "Clear conversation": close the current conversation (history is
    // PRESERVED for merchant analytics) and start a new one.
    const existing = await prisma.conversation.findFirst({
      where: {
        tenantId: context.tenantId,
        channel: "web",
        visitorId,
        status: "active",
      },
    });

    if (existing) {
      await prisma.conversation.update({
        where: { id: existing.id },
        data: { status: "closed" },
      });
    }

    const fresh = await prisma.conversation.create({
      data: {
        tenantId: context.tenantId,
        channel: "web",
        visitorId,
        status: "active",
      },
    });

    return NextResponse.json({ success: true, conversationId: fresh.id });
  } catch (error) {
    console.error("[CONVERSATION] Clear failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
