import { NextResponse } from "next/server";
import { processMessage } from "@/lib/ai/commerce-engine";
import {
  getOrCreateConversation,
  getConversationHistory,
  saveMessage,
} from "@/lib/ai/conversation-service";
import { prisma } from "@/lib/db/prisma";
import {
  buildCorsHeaders,
  fetchAllowedSiteUrls,
  isAllowedWebsiteOrigin,
} from "@/lib/web/cors";
import {
  resolveSiteTokenContext,
  resolveConversationContext,
  type WebsiteContext,
} from "@/lib/web/site-access";
import {
  buildProductCards,
  extractMentionedProductIds,
  extractProductIdsFromHistory,
  isGreeting,
  pickProducts,
  stripProductMarkers,
  type CatalogProduct,
  type ProductCard,
} from "@/lib/commerce/catalog-matcher";

/**
 * POST /api/chat
 *
 * Website AI chat endpoint for the merchant's floating widget.
 *
 * The website is hosted on a different origin from Karta Cloud, so this
 * endpoint implements CORS: the allowed origin is the connected
 * WooCommerce store's siteUrl (never "*"), and OPTIONS/preflight is
 * handled explicitly. Without this, browsers block every cross-origin
 * widget request.
 *
 * Tenant resolution (no global first-tenant fallback):
 *   siteToken (public widget identifier) → WooCommerceConnection → tenant
 *   or conversationId → conversation → tenant (continuation)
 *
 * AI flow (deterministic first, AI for natural language):
 *   1. Deterministic catalog matching from real WooCommerce data
 *   2. LLM writes the response referencing candidates via [PRODUCT:id]
 *   3. Markers are resolved deterministically into structured product
 *      cards — the AI never invents URLs, images, prices, or stock
 *
 * Request body:
 * {
 *   "message": "string",
 *   "conversationId": "string" (optional),
 *   "siteToken": "string" (public widget identifier)
 * }
 *
 * Response:
 * {
 *   "success": true,
 *   "aiSuccess": true,
 *   "conversationId": "string",
 *   "response": "string",
 *   "products": [ { id, name, price, imageUrl, productUrl, ... } ]
 * }
 */

// ─── OPTIONS: CORS preflight ─────────────────────────────────

export async function OPTIONS(request: Request) {
  const origin = request.headers.get("origin");

  if (!origin) {
    return new Response(null, { status: 204 });
  }

  const allowed = await isOriginAllowed(origin);
  if (!allowed) {
    // No Access-Control-Allow-Origin header → the browser blocks the
    // request. This is the correct behavior for unknown origins.
    return new Response(null, { status: 403 });
  }

  return new Response(null, { status: 204, headers: buildCorsHeaders(origin) });
}

async function isOriginAllowed(origin: string): Promise<boolean> {
  const siteUrls = await fetchAllowedSiteUrls();
  return isAllowedWebsiteOrigin(origin, siteUrls);
}

// ─── POST: Website chat ──────────────────────────────────────

export async function POST(request: Request) {
  const origin = request.headers.get("origin");

  // CORS: the request origin must be associated with a connected store.
  // Blocked origins get a 403 WITHOUT an Allow-Origin header so the
  // browser blocks the response (non-browser clients see the error).
  if (origin) {
    const allowed = await isOriginAllowed(origin);
    if (!allowed) {
      return NextResponse.json({ error: "Origin not allowed" }, { status: 403 });
    }
  }

  const corsHeaders: Record<string, string> = origin ? buildCorsHeaders(origin) : {};

  try {
    const body = await request.json().catch(() => null);
    const message = typeof body?.message === "string" ? body.message.trim() : "";
    const siteToken = typeof body?.siteToken === "string" ? body.siteToken.trim() : "";
    const providedConversationId =
      typeof body?.conversationId === "string" ? body.conversationId.trim() : "";

    if (!message) {
      return NextResponse.json(
        { error: "Message is required" },
        { status: 400, headers: corsHeaders }
      );
    }

    // ─── Resolve tenant: siteToken → connection → tenant ──────
    let context: WebsiteContext | null = null;

    if (siteToken) {
      context = await resolveSiteTokenContext(siteToken);
      if (!context) {
        return NextResponse.json(
          { error: "Invalid site token" },
          { status: 401, headers: corsHeaders }
        );
      }
    } else if (providedConversationId) {
      context = await resolveConversationContext(providedConversationId);
      if (!context) {
        return NextResponse.json(
          { error: "Invalid conversation" },
          { status: 401, headers: corsHeaders }
        );
      }
    } else {
      return NextResponse.json(
        { error: "Site token or conversation ID required" },
        { status: 401, headers: corsHeaders }
      );
    }

    // The request origin must belong to the connected store.
    if (origin && context.siteUrl && !isAllowedWebsiteOrigin(origin, [context.siteUrl])) {
      return NextResponse.json(
        { error: "Origin not allowed for this store" },
        { status: 403, headers: corsHeaders }
      );
    }

    const tenantId = context.tenantId;

    // ─── Conversation (continuation or new, scoped to tenant) ─
    const conversation = providedConversationId
      ? await prisma.conversation.findUnique({ where: { id: providedConversationId } })
      : await getOrCreateConversation(tenantId, "web");

    if (!conversation || conversation.tenantId !== tenantId) {
      return NextResponse.json(
        { error: "Invalid conversation" },
        { status: 401, headers: corsHeaders }
      );
    }

    // ─── Greetings: deterministic, no LLM call ────────────────
    // A pure greeting never needs product data, so it is answered
    // deterministically (instant response, no provider latency, and the
    // LLM never dumps a product table on "hi").
    if (isGreeting(message)) {
      await saveMessage(conversation.id, "user", message);
      const greetingText = `Hi! I'm Karta, your AI shopping assistant${context.siteName ? ` for ${context.siteName}` : ""}. What are you looking for today?`;
      await saveMessage(conversation.id, "assistant", greetingText);
      return NextResponse.json(
        {
          success: true,
          aiSuccess: true,
          conversationId: conversation.id,
          response: greetingText,
          products: [],
        },
        { headers: corsHeaders }
      );
    }

    // ─── Real WooCommerce product data (deterministic source of truth)
    const catalog = await loadCatalog(tenantId);

    // Conversation history (assistant messages carry [PRODUCT:id]
    // markers internally, enabling follow-ups like "black ta dekhaw")
    const history = await getConversationHistory(conversation.id);
    const recentProductIds = extractProductIdsFromHistory(history);

    // Deterministic matching first — never delegated to the LLM
    const candidates = pickProducts(catalog, message, recentProductIds);

    // Save user message
    await saveMessage(conversation.id, "user", message);

    // ─── AI: natural-language response only ───────────────────
    const result = await processMessage(
      {
        tenantId,
        channel: "web",
        conversationId: conversation.id,
        text: message,
        timestamp: new Date().toISOString(),
      },
      history,
      {
        extraSystem: buildWebsiteSystemSupplement(context, candidates, isGreeting(message)),
      }
    );

    // Resolve [PRODUCT:id] markers into structured cards. If the AI
    // mentioned none, fall back to the deterministic candidates so the
    // widget always shows the right products.
    const mentionedIds = extractMentionedProductIds(result.text);
    const products: ProductCard[] =
      mentionedIds.length > 0
        ? buildProductCards(catalog, mentionedIds, 4)
        : candidates.length > 0
          ? buildProductCards(catalog, candidates.slice(0, 4).map((p) => p.id), 4)
          : [];

    // Clean text for the browser (markers are internal)
    const responseText = stripProductMarkers(result.text);

    // Save assistant response WITH markers so follow-up questions
    // can resolve the previously discussed products.
    const storedText =
      mentionedIds.length > 0
        ? result.text
        : products.length > 0
          ? `${responseText}\n${products.map((p) => `[PRODUCT:${p.id}]`).join("\n")}`
          : responseText;

    if (storedText) {
      await saveMessage(conversation.id, "assistant", storedText);
    }

    return NextResponse.json(
      {
        success: true,
        aiSuccess: result.success && Boolean(responseText),
        conversationId: conversation.id,
        response: responseText,
        products,
      },
      { headers: corsHeaders }
    );
  } catch (error) {
    console.error("Chat API error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500, headers: corsHeaders }
    );
  }
}

// ─── Helpers ─────────────────────────────────────────────────

/**
 * Load the tenant's active products with variants (real WooCommerce data).
 */
async function loadCatalog(tenantId: string): Promise<CatalogProduct[]> {
  const products = await prisma.product.findMany({
    where: { tenantId, status: "active" },
    include: { variants: true },
    orderBy: { createdAt: "asc" },
  });

  return products.map((p) => ({
    id: p.id,
    externalId: p.externalId,
    name: p.name,
    description: p.description,
    price: Number(p.price),
    compareAtPrice: p.compareAtPrice ? Number(p.compareAtPrice) : null,
    stock: p.stock,
    status: p.status,
    image: p.image,
    productUrl: p.productUrl,
    sku: p.sku,
    category: p.category,
    variants: p.variants.map((v) => ({
      id: v.id,
      name: v.name,
      attributes: (v.attributes as Record<string, string>) || {},
      price: Number(v.price),
      stock: v.stock,
    })),
  }));
}

/**
 * Website-specific AI supplement. Injected as a system message via the
 * conversation history (the shared commerce engine is unchanged, so
 * WhatsApp behavior is not affected).
 *
 * The LLM is a language layer only — the candidate products were already
 * selected deterministically from the real catalog.
 */
function buildWebsiteSystemSupplement(
  context: WebsiteContext,
  candidates: CatalogProduct[],
  greeting: boolean
): string {
  const lines: string[] = [
    "## Website widget context",
    `You are answering on the merchant's website chat widget${context.siteName ? ` (${context.siteName})` : ""}.`,
  ];

  if (greeting) {
    lines.push(
      "The customer just said hello. Greet them briefly and ask what they are looking for. Do NOT show products."
    );
  } else if (candidates.length > 0) {
    lines.push(
      "These candidate products were deterministically selected from the live catalog for this message. Recommend ONLY these products:",
      JSON.stringify(
        candidates.slice(0, 8).map((p) => ({
          id: p.id,
          name: p.name,
          category: p.category,
          price: Number(p.price),
          compareAtPrice: p.compareAtPrice ? Number(p.compareAtPrice) : null,
          stock: p.stock,
          stockManaged: p.stock !== null,
          available: p.stock === null ? p.status === "active" : p.stock > 0,
          sku: p.sku,
          variants: p.variants.map((v) => ({
            name: v.name,
            attributes: v.attributes,
            price: Number(v.price),
            stock: v.stock,
          })),
          productUrl: p.productUrl,
        })),
        null,
        0
      ),
      "Rules:",
      "- For EVERY product you mention, add a marker line [PRODUCT:<id>] on its own line.",
      "- Mention at most 4 products.",
      "- NEVER invent products, prices, stock, discounts, specifications, images, or URLs.",
      "- Only use data from the candidate list. If stock is null, say availability is not limited/unknown — never say out of stock.",
      "- Match the customer's language (Bangla, Banglish, or English).",
      "- Keep responses concise — customers are shopping, not reading essays."
    );
  } else {
    lines.push(
      "No catalog products matched this message. If the customer is looking for products, tell them you couldn't find matching products and ask what they are looking for. NEVER invent products or prices."
    );
  }

  return lines.join("\n");
}
