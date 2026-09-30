import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { processMessage } from "@/lib/ai/commerce-engine";
import { classifyProviderFailure, providerStatusFromCode, type AIProviderErrorCode } from "@/lib/ai/provider-error";
import {
  isProviderCoolingDown,
  recordProviderFailure,
  recordProviderSuccess,
  lastProviderFailureCode,
} from "@/lib/ai/circuit-breaker";
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
  buildBudgetCheckText,
  buildConfirmationQuestion,
  buildGreetingText,
  buildIntroText,
  buildNoMatchText,
  buildPriceAnswer,
  buildProductCards,
  buildProviderFallbackText,
  detectCategoryKey,
  detectColor,
  detectSize,
  extractBudgetRange,
  extractProductIdsFromHistory,
  extractQuantity,
  findProductByName,
  hasProductSignal,
  isConfirmation,
  isGreeting,
  pickProducts,
  productHasColor,
  referencesRecentProduct,
  resolveVariant,
  sanitizeAssistantText,
  variantSummary,
  wantsToAddToCart,
  type CatalogProduct,
} from "@/lib/commerce/catalog-matcher";

/**
 * POST /api/chat
 *
 * Website AI shopping-assistant endpoint for the merchant's widget.
 *
 * The website is hosted on a different origin from Karta Cloud, so this
 * endpoint implements CORS: the allowed origin is the connected
 * WooCommerce store's siteUrl (never "*"), and OPTIONS/preflight is
 * handled explicitly.
 *
 * Tenant resolution (no global first-tenant fallback):
 *   siteToken (public widget identifier) → WooCommerceConnection → tenant
 *   or conversationId → conversation → tenant (continuation, requires the
 *   tenant to still have an active connection)
 *
 * AI flow — DETERMINISTIC FIRST, LLM for natural language only:
 *   1. Intent, budget math, product/variant matching, availability: all
 *      deterministic, from real WooCommerce data (never the LLM)
 *   2. The LLM never generates product tables/cards/URLs/prices/stock —
 *      its text is sanitized and the frontend renders product cards from
 *      the structured response
 *   3. Add-to-cart requires explicit customer confirmation; the widget
 *      then performs the cart action against the merchant's own
 *      WooCommerce cart bridge (session-aware, same origin)
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
 *   "message": "short assistant text",
 *   "response": "same as message (compat alias)",
 *   "intent": "GREETING | PRODUCT_SEARCH | ...",
 *   "products": [ { id, name, price, imageUrl, productUrl, ... } ],
 *   "selectedProduct": { ... } | null,
 *   "cartAction": { type, productId, variationId, quantity } | null,
 *   "location": "string" | null
 * }
 */

interface ConversationMetadata {
  selectedProductId?: string;
  selectedVariantId?: string;
  pendingCart?: {
    productId: string;
    variationId: string | null;
    variationExternalId: string | null;
    quantity: number;
  } | null;
  location?: string | null;
}

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

// ─── POST: Website shopping assistant ────────────────────────

export async function POST(request: Request) {
  const origin = request.headers.get("origin");

  // CORS: the request origin must be associated with a connected store.
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
    // Explicit product target from a card action (deterministic, DB-sourced
    // ID from the product card — never invented by the LLM)
    const targetProductId =
      typeof body?.targetProductId === "string" ? body.targetProductId.trim() : "";

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

    const metadata: ConversationMetadata =
      ((conversation as { metadata?: unknown }).metadata as ConversationMetadata) || {};

    // ─── Greetings: deterministic, no LLM call ────────────────
    if (isGreeting(message)) {
      await saveMessage(conversation.id, "user", message);
      const greetingText = buildGreetingText(context.siteName);
      await saveMessage(conversation.id, "assistant", greetingText);
      return ok(corsHeaders, {
        success: true,
        aiSuccess: true,
        conversationId: conversation.id,
        message: greetingText,
        response: greetingText,
        intent: "GREETING",
        products: [],
        selectedProduct: null,
        cartAction: null,
        location: metadata.location ?? null,
      });
    }

    // ─── Real WooCommerce product data (deterministic source of truth)
    const inventoryMode = context.inventoryMode;
    const catalog = await loadCatalog(tenantId);

    // Conversation context: persisted metadata + history markers
    const history = await getConversationHistory(conversation.id);
    const recentProductIds = [
      ...(metadata.selectedProductId ? [metadata.selectedProductId] : []),
      ...extractProductIdsFromHistory(history),
    ];
    const recentProducts = recentProductIds
      .map((id) => catalog.find((p) => p.id === id))
      .filter((p): p is CatalogProduct => p !== undefined && p.status === "active");

    // ─── Location: persist when the customer answers a delivery question
    let location = metadata.location ?? null;
    const lastAssistant = [...history].reverse().find((m) => m.role === "assistant");
    const askedAboutLocation =
      lastAssistant &&
      /(?:delivery|shipping|এলাকা|জেলা|area|district|address|ঠিকানা|কোথায়)/i.test(
        lastAssistant.content
      );
    if (
      askedAboutLocation &&
      !isConfirmation(message) &&
      !message.includes("?") && // a question is not a location answer
      message.length <= 80
    ) {
      location = message;
    }

    // ─── FLOW 1: explicit confirmation of a pending add-to-cart ─
    if (isConfirmation(message) && metadata.pendingCart) {
      const pending = metadata.pendingCart;
      const product = catalog.find((p) => p.id === pending.productId);

      if (!product || product.status !== "active") {
        await saveMessage(conversation.id, "user", message);
        await saveMessage(conversation.id, "assistant", buildNoMatchText());
        await persistMetadata(conversation.id, { ...metadata, pendingCart: null, location });
        return ok(corsHeaders, {
          success: true,
          aiSuccess: true,
          conversationId: conversation.id,
          message: buildNoMatchText(),
          response: buildNoMatchText(),
          intent: "NO_MATCH",
          products: [],
          selectedProduct: null,
          cartAction: null,
          location,
        });
      }

      // Cart action for the widget: it performs the add against the
      // merchant's own WooCommerce cart bridge (session-aware, same
      // origin, nonce-protected). WooCommerce owns cart/checkout/tax.
      // The merchant's inventory policy travels with the action so the
      // bridge can support unlimited-inventory stores safely.
      const cartAction = {
        type: "addToCart",
        productId: product.externalId, // WooCommerce product ID
        variationId: pending.variationExternalId, // WooCommerce variation ID or null
        quantity: pending.quantity,
        productName: product.name,
        inventoryMode,
      };

      const introText = "দারুণ! কার্টে যোগ করছি...";
      await saveMessage(conversation.id, "user", message);
      await saveMessage(conversation.id, "assistant", introText);
      await persistMetadata(conversation.id, {
        ...metadata,
        pendingCart: null,
        selectedProductId: product.id,
        selectedVariantId: pending.variationId ?? undefined,
        location,
      });

      return ok(corsHeaders, {
        success: true,
        aiSuccess: true,
        conversationId: conversation.id,
        message: introText,
        response: introText,
        intent: "ADD_TO_CART_CONFIRMED",
        products: buildProductCards(catalog, [product.id], 1, inventoryMode),
        selectedProduct: buildProductCards(catalog, [product.id], 1, inventoryMode)[0] ?? null,
        cartAction,
        location,
      });
    }

    // ─── FLOW 2: add-to-cart intent → resolve exact product/variant ─
    // An explicit target (a card click) overrides any pending confirmation —
    // the customer's newest explicit intent supersedes the pending one.
    if (wantsToAddToCart(message) && (!metadata.pendingCart || targetProductId)) {
      await saveMessage(conversation.id, "user", message);

      const quantity = extractQuantity(message);
      const color = detectColor(message);
      const size = detectSize(message);

      // Resolve the target product deterministically: an explicit card
      // target first, then recent/selected context, then a name match,
      // then category candidates.
      let target: CatalogProduct | undefined = undefined;
      if (targetProductId) {
        const explicit = catalog.find((p) => p.id === targetProductId);
        if (explicit && explicit.status === "active") {
          target = explicit;
        }
      }
      if (!target && color) {
        target = recentProducts.find((p) => productHasColor(p, color)) || recentProducts[0];
      }
      if (!target && recentProducts.length) {
        target = recentProducts[0];
      }
      if (!target) {
        target = findProductByName(catalog, message) ?? undefined;
      }
      if (!target) {
        const categoryKey = detectCategoryKey(message);
        if (categoryKey) {
          target = pickProducts(catalog, message, [], inventoryMode)[0];
        }
      }

      if (!target) {
        await saveMessage(conversation.id, "assistant", buildNoMatchText());
        await persistMetadata(conversation.id, { ...metadata, location });
        return ok(corsHeaders, {
          success: true,
          aiSuccess: true,
          conversationId: conversation.id,
          message: buildNoMatchText(),
          response: buildNoMatchText(),
          intent: "NO_MATCH",
          products: [],
          selectedProduct: null,
          cartAction: null,
          location,
        });
      }

      // Resolve the exact variation deterministically (never the LLM)
      const variant = resolveVariant(target, { color, size });

      // Variable product with an unresolved variant → ask which one
      if (target.variants.length > 1 && !variant) {
        const clarifyText = `${target.name} এর কোন ভ্যারিয়েন্ট চান? Available: ${target.variants.map(variantSummary).join(", ")}`;
        await saveMessage(conversation.id, "assistant", clarifyText);
        await persistMetadata(conversation.id, {
          ...metadata,
          pendingCart: { productId: target.id, variationId: null, variationExternalId: null, quantity },
          selectedProductId: target.id,
          location,
        });
        return ok(corsHeaders, {
          success: true,
          aiSuccess: true,
          conversationId: conversation.id,
          message: clarifyText,
          response: clarifyText,
          intent: "CLARIFY_VARIANT",
          products: buildProductCards(catalog, [target.id], 1, inventoryMode),
          selectedProduct: buildProductCards(catalog, [target.id], 1, inventoryMode)[0] ?? null,
          cartAction: null,
          location,
        });
      }

      // Simple or resolved variant → require explicit confirmation
      const confirmText = buildConfirmationQuestion(target, quantity, variant);
      await saveMessage(conversation.id, "assistant", confirmText);
      await persistMetadata(conversation.id, {
        ...metadata,
        pendingCart: {
          productId: target.id,
          variationId: variant?.id ?? null,
          variationExternalId: variant?.externalId ?? null,
          quantity,
        },
        selectedProductId: target.id,
        selectedVariantId: variant?.id ?? undefined,
        location,
      });

      return ok(corsHeaders, {
        success: true,
        aiSuccess: true,
        conversationId: conversation.id,
        message: confirmText,
        response: confirmText,
        intent: "CONFIRM_ADD_TO_CART",
        products: buildProductCards(catalog, [target.id], 1, inventoryMode),
        selectedProduct: buildProductCards(catalog, [target.id], 1, inventoryMode)[0] ?? null,
        cartAction: null,
        location,
      });
    }

    // ─── FLOW 3: deterministic price/budget check on a discussed product
    const range = extractBudgetRange(message);
    const priceQuestion = /(?:\bdam\b|\bprice\b|\bkoto\b|কত|দাম|kothay pabo|পাবো)/i.test(message);

    if (
      recentProducts.length &&
      range &&
      range.max !== null &&
      referencesRecentProduct(message)
    ) {
      // Deterministic budget check against the discussed product
      // ("eta 1000 takar moddhe?") — only when the message actually
      // references it; bare budget queries are product searches.
      const target = recentProducts[0];
      const variant = resolveVariant(target, { color: detectColor(message), size: detectSize(message) });
      const checkText = buildBudgetCheckText(target, variant, range.max);
      await saveMessage(conversation.id, "user", message);
      await saveMessage(conversation.id, "assistant", checkText);
      await persistMetadata(conversation.id, { ...metadata, location });
      return ok(corsHeaders, {
        success: true,
        aiSuccess: true,
        conversationId: conversation.id,
        message: checkText,
        response: checkText,
        intent: "BUDGET_CHECK",
        products: buildProductCards(catalog, [target.id], 1, inventoryMode),
        selectedProduct: buildProductCards(catalog, [target.id], 1, inventoryMode)[0] ?? null,
        cartAction: null,
        location,
      });
    }

    if (recentProducts.length && priceQuestion && !detectCategoryKey(message) && !referencesRecentProduct(message)) {
      // Direct price question about the discussed product
      const target = recentProducts[0];
      const variant = resolveVariant(target, { color: detectColor(message), size: detectSize(message) });
      const priceText = buildPriceAnswer(target, variant);
      await saveMessage(conversation.id, "user", message);
      await saveMessage(conversation.id, "assistant", priceText);
      await persistMetadata(conversation.id, { ...metadata, location });
      return ok(corsHeaders, {
        success: true,
        aiSuccess: true,
        conversationId: conversation.id,
        message: priceText,
        response: priceText,
        intent: "PRICE_CHECK",
        products: buildProductCards(catalog, [target.id], 1, inventoryMode),
        selectedProduct: buildProductCards(catalog, [target.id], 1, inventoryMode)[0] ?? null,
        cartAction: null,
        location,
      });
    }

    // ─── FLOW 4: product search (deterministic candidates + cards) ─
    // Gated on product-commerce intent: general questions (delivery,
    // small talk) go to the LLM instead of dumping the catalog.
    if (hasProductSignal(message)) {
      const candidates = pickProducts(catalog, message, recentProductIds, inventoryMode);

      if (candidates.length > 0) {
        const cards = buildProductCards(
          catalog,
          candidates.slice(0, 4).map((p) => p.id),
          4,
          inventoryMode
        );
        const intro = buildIntroText(candidates, message);
        await saveMessage(conversation.id, "user", message);
        const storedAssistant = `${intro}\n${cards.map((c) => `[PRODUCT:${c.id}]`).join("\n")}`;
        await saveMessage(conversation.id, "assistant", storedAssistant);
        await persistMetadata(conversation.id, {
          ...metadata,
          selectedProductId: candidates[0].id,
          location,
        });

        return ok(corsHeaders, {
          success: true,
          aiSuccess: true,
          conversationId: conversation.id,
          message: intro,
          response: intro,
          intent: referencesRecentProduct(message) ? "FOLLOW_UP" : "PRODUCT_SEARCH",
          products: cards,
          selectedProduct: cards[0] ?? null,
          cartAction: null,
          location,
        });
      }

      // Specific product signal (category/budget/color/size/name/follow-up)
      // but no matching products → deterministic no-match, no LLM needed.
      await saveMessage(conversation.id, "user", message);
      await saveMessage(conversation.id, "assistant", buildNoMatchText());
      await persistMetadata(conversation.id, { ...metadata, location });
      return ok(corsHeaders, {
        success: true,
        aiSuccess: true,
        conversationId: conversation.id,
        message: buildNoMatchText(),
        response: buildNoMatchText(),
        intent: "NO_MATCH",
        products: [],
        selectedProduct: null,
        cartAction: null,
        location,
      });
    }

    // ─── FLOW 5: general question → LLM for natural language ─
    // The LLM gets strict rules: no Markdown tables, no product data in
    // text, short replies. Its output is sanitized.
    //
    // GROQ IS NEVER REQUIRED FOR BASIC PRODUCT COMMERCE: this flow only
    // runs when the deterministic matcher found no candidates. If the
    // provider is rate limited/unavailable, a concise deterministic
    // clarification is returned — product discovery never depended on it.
    await saveMessage(conversation.id, "user", message);

    let result;
    let aiProviderStatus: string | null = null;

    if (isProviderCoolingDown()) {
      // Short provider cooldown/circuit breaker: burst customer messages
      // do not create burst failed provider calls.
      aiProviderStatus = providerStatusFromCode(lastProviderFailureCode() ?? "AI_PROVIDER_RATE_LIMITED");
      result = { text: "", success: false, errorCode: lastProviderFailureCode() ?? "AI_PROVIDER_RATE_LIMITED" };
    } else {
      result = await processMessage(
        {
          tenantId,
          channel: "web",
          conversationId: conversation.id,
          text: message,
          timestamp: new Date().toISOString(),
        },
        history,
        { extraSystem: buildWebsiteSystemSupplement(context, location) }
      );

      if (!result.success) {
        // The engine classifies the provider failure (429 →
        // AI_PROVIDER_RATE_LIMITED, etc.). Record it here too so the
        // breaker opens even when the failure surfaces via the result,
        // and surface only the sanitized internal status — never
        // provider names, keys, or internals to the customer.
        const code =
          (result.errorCode as AIProviderErrorCode | undefined) ??
          classifyProviderFailure(new Error(result.error || "Provider failure")).code;
        recordProviderFailure(code);
        aiProviderStatus = providerStatusFromCode(code);
      } else {
        recordProviderSuccess();
      }
    }

    // Deterministic fallback: never show provider errors to customers
    const fallback = result.success ? buildNoMatchText() : buildProviderFallbackText(message);
    const responseText = sanitizeAssistantText(result.text) || fallback;

    await saveMessage(conversation.id, "assistant", responseText);
    await persistMetadata(conversation.id, { ...metadata, location });

    return ok(corsHeaders, {
      success: true,
      aiSuccess: result.success && Boolean(responseText),
      // Internal provider status (sanitized: "rate_limited", "unavailable",
      // ...) — for monitoring/UX decisions only, never a customer-facing
      // provider error.
      aiProviderStatus,
      conversationId: conversation.id,
      message: responseText,
      response: responseText,
      intent: "GENERAL",
      products: [],
      selectedProduct: null,
      cartAction: null,
      location,
    });
  } catch (error) {
    console.error("Chat API error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500, headers: corsHeaders }
    );
  }
}

// ─── Helpers ─────────────────────────────────────────────────

function ok(corsHeaders: Record<string, string>, payload: Record<string, unknown>) {
  return NextResponse.json(payload, { headers: corsHeaders });
}

async function persistMetadata(conversationId: string, metadata: ConversationMetadata) {
  try {
    await prisma.conversation.update({
      where: { id: conversationId },
      data: { metadata: metadata as unknown as Prisma.InputJsonValue },
    });
  } catch (error) {
    console.error("Failed to persist conversation metadata:", error);
  }
}

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
}

/**
 * Website-specific AI supplement for general questions. Injected via the
 * conversation history (the shared commerce engine is unchanged, so
 * WhatsApp behavior is not affected).
 *
 * The LLM is a language layer only — it must never produce product
 * tables, cards, URLs, prices, or stock data in its text.
 */
function buildWebsiteSystemSupplement(context: WebsiteContext, location: string | null): string {
  const lines: string[] = [
    "## Website widget context",
    `You are answering on the merchant's website chat widget${context.siteName ? ` (${context.siteName})` : ""}.`,
    "",
    "STRICT FORMAT RULES:",
    "- Reply in 1-3 SHORT sentences. The customer is shopping, not reading essays.",
    "- NEVER use Markdown tables, bullet lists, or headers.",
    "- NEVER put product prices, product URLs, image links, or stock counts in your text — the frontend renders product cards automatically from the structured data.",
    "- NEVER invent products, prices, stock, discounts, specifications, images, or URLs.",
    "- Match the customer's language (Bangla, Banglish, or English).",
    "- Ask ONE useful clarification when necessary (e.g. color, size, or delivery area).",
    "- Never fabricate scarcity or urgency. Never pressure the customer.",
  ];

  if (context.inventoryMode === "unlimited") {
    lines.push(
      "- INVENTORY IS UNLIMITED for this store: never say a product is out of stock, never mention stock quantities or limits, and never cap how many a customer can order."
    );
  }

  if (location) {
    lines.push(`- The customer's delivery location is: "${location}". Use it when discussing delivery.`);
  }

  lines.push(
    "- When the customer asks about delivery or shipping, ask naturally which area/district the delivery should go to. Never make up shipping fees or delivery times."
  );

  return lines.join("\n");
}
