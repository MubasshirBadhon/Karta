import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { verifyWebhookSignature, validateVerificationRequest, isValidWebhookPayload } from "@/lib/channels/whatsapp/webhook";
import { processWebhookPayload } from "@/lib/channels/whatsapp/adapter";
import { getWhatsAppProvider } from "@/lib/channels/whatsapp/provider";
import { processMessage } from "@/lib/ai/commerce-engine";
import { getConversationHistory, saveMessage } from "@/lib/ai/conversation-service";
import { prisma } from "@/lib/db/prisma";
import {
  buildConfirmationQuestion,
  buildNoMatchText,
  detectColor,
  detectSize,
  extractMentionedProductIds,
  extractProductIdsFromHistory,
  extractQuantity,
  findProductByName,
  isConfirmation,
  isProductAvailable,
  pickProducts,
  referencesRecentProduct,
  resolveVariant,
  stripProductMarkers,
  wantsToAddToCart,
  type CatalogProduct,
  type InventoryMode,
} from "@/lib/commerce/catalog-matcher";
import { addItemToCart, formatCartSummary } from "@/lib/commerce/woo-cart-store";

// ─── GET: Webhook Verification ────────────────────────────────

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const mode = searchParams.get("hub.mode");
  const token = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");

  const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN;
  if (!verifyToken) {
    return NextResponse.json(
      { error: "WhatsApp verify token not configured" },
      { status: 500 }
    );
  }

  const result = validateVerificationRequest(mode || "", token || "", challenge || "", verifyToken);

  if (result) {
    return new Response(result, { status: 200 });
  }

  return NextResponse.json(
    { error: "Verification failed" },
    { status: 403 }
  );
}

// ─── POST: Receive Webhook Events ─────────────────────────────

interface WhatsAppMetadata {
  selectedProductId?: string;
  selectedVariantId?: string;
  pendingCart?: {
    productId: string;
    variationId: string | null;
    variationExternalId: string | null;
    quantity: number;
    price: number;
  } | null;
}

export async function POST(request: Request) {
  try {
    // Verify webhook signature
    const signature = request.headers.get("x-hub-signature-256");
    const appSecret = process.env.WHATSAPP_APP_SECRET;

    if (!signature || !appSecret) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.text();

    if (!verifyWebhookSignature(body, signature, appSecret)) {
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }

    // Parse payload
    const payload = JSON.parse(body);

    if (!isValidWebhookPayload(payload)) {
      return NextResponse.json({ status: "ok" });
    }

    // Get the tenant (existing demo resolution — unchanged)
    const tenant = await prisma.tenant.findFirst({
      orderBy: { createdAt: "asc" },
    });

    if (!tenant) {
      return NextResponse.json({ status: "ok" });
    }

    const inventoryMode: InventoryMode = tenant.inventoryMode === "managed" ? "managed" : "unlimited";
    const connection = await prisma.wooCommerceConnection.findFirst({
      where: { tenantId: tenant.id, status: "active" },
      select: { siteUrl: true },
    });
    const siteUrl = connection?.siteUrl || "";

    // Process messages
    const unifiedMessages = await processWebhookPayload(payload);

    // Process each message through AI engine
    for (const message of unifiedMessages) {
      try {
        const phone = message.customerId?.replace("wa_", "") || "";

        // Save inbound message
        await saveMessage(message.conversationId!, "user", message.text);

        // Get conversation history
        const history = await getConversationHistory(message.conversationId!);

        // ─── Deterministic WhatsApp cart flow (add-to-cart / confirmation).
        // Only these intents are intercepted; everything else goes to the
        // AI engine unchanged.
        if (phone) {
          const cartResponse = await handleWhatsAppCartFlow(
            tenant.id,
            inventoryMode,
            siteUrl,
            phone,
            message.conversationId!,
            history,
            message.text
          );

          if (cartResponse) {
            await saveMessage(message.conversationId!, "assistant", cartResponse);
            const provider = getWhatsAppProvider();
            await provider.sendTextMessage({
              phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID!,
              recipientPhone: phone,
              text: cartResponse,
            });
            continue;
          }
        }

        // Process through AI engine
        const result = await processMessage(message, history, {
          extraSystem: buildWhatsAppSupplement(inventoryMode),
        });

        // Track mentioned products for cart follow-ups (markers are
        // internal — they are stripped before the message is sent)
        const mentionedIds = extractMentionedProductIds(result.text);
        const cleanText = stripProductMarkers(result.text);

        // Save outbound message WITH markers so follow-ups resolve the
        // previously discussed product
        const storedText =
          mentionedIds.length > 0
            ? result.text
            : cleanText;
        if (storedText) {
          await saveMessage(message.conversationId!, "assistant", storedText);
        }

        if (mentionedIds.length > 0) {
          const conversation = await prisma.conversation.findUnique({
            where: { id: message.conversationId! },
            select: { metadata: true },
          });
          const metadata: WhatsAppMetadata = (conversation?.metadata as WhatsAppMetadata) || {};
          await prisma.conversation.update({
            where: { id: message.conversationId! },
            data: {
              metadata: {
                ...metadata,
                selectedProductId: mentionedIds[0],
              } as unknown as Prisma.InputJsonValue,
            },
          });
        }

        // Send response via WhatsApp (markers stripped — clean text only)
        if (cleanText) {
          const provider = getWhatsAppProvider();
          await provider.sendTextMessage({
            phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID!,
            recipientPhone: phone,
            text: cleanText,
          });
        }
      } catch (error) {
        // Log sanitized error, don't expose internals
        console.error("Error processing WhatsApp message:", {
          conversationId: message.conversationId,
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }

    return NextResponse.json({ status: "ok" });
  } catch {
    return NextResponse.json({ status: "ok" });
  }
}

// ─── Helpers ─────────────────────────────────────────────────

/**
 * Deterministic WhatsApp cart flow. Returns a customer reply string when
 * the message is an add-to-cart intent or a confirmation of a pending
 * add; null otherwise (the AI engine handles it).
 *
 * Cart identity: tenantId + WhatsApp phone → a persistent cartToken
 * stored server-side (Karta). The customer's REAL WooCommerce cart is
 * materialized when they open their personal cart-restore link
 * (?karta-cart=<cartToken>) — the plugin adds the items with Woo-native
 * APIs and redirects to the real WooCommerce checkout page.
 */
async function handleWhatsAppCartFlow(
  tenantId: string,
  inventoryMode: InventoryMode,
  siteUrl: string,
  phone: string,
  conversationId: string,
  history: Array<{ role: string; content: string }>,
  message: string
): Promise<string | null> {
  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: { metadata: true },
  });
  const metadata: WhatsAppMetadata = (conversation?.metadata as WhatsAppMetadata) || {};

  // ─── Explicit confirmation of a pending add ─────────────────
  if (isConfirmation(message) && metadata.pendingCart) {
    const pending = metadata.pendingCart;
    const catalog = await loadWhatsAppCatalog(tenantId);
    const product = catalog.find((p) => p.id === pending.productId);

    if (!product || product.status !== "active") {
      await prisma.conversation.update({
        where: { id: conversationId },
        data: { metadata: { ...metadata, pendingCart: null } },
      });
      return "দুঃখিত, এই পণ্যটি এখন আর পাওয়া যাচ্ছে না।";
    }

    // WooCommerce's purchasability/stock status must be respected — in
    // managed inventory mode an unavailable product is refused here.
    if (inventoryMode === "managed" && !isProductAvailable(product, "managed")) {
      await prisma.conversation.update({
        where: { id: conversationId },
        data: { metadata: { ...metadata, pendingCart: null } },
      });
      return "দুঃখিত, এই পণ্যটি বর্তমানে স্টকে নেই।";
    }

    // Resolve/obtain the customer's persistent cart (token stored server-side)
    const cart = await addItemToCart(tenantId, phone, {
      productId: product.externalId ?? "",
      variationId: pending.variationExternalId,
      quantity: pending.quantity,
      name: product.name,
      price: pending.price,
    });

    // Verify the returned cart actually contains the item — never claim
    // success if WooCommerce-side state is missing
    const inCart = cart.items.find((i) => i.productId === (product.externalId ?? ""));
    if (!inCart) {
      return "দুঃখিত, পণ্যটি কার্টে যোগ করা যায়নি। আবার চেষ্টা করুন।";
    }

    // Clear the pending state
    await prisma.conversation.update({
      where: { id: conversationId },
      data: { metadata: { ...metadata, pendingCart: null, selectedProductId: product.id } },
    });

    // Reply: product, quantity, cart total + the personal checkout link
    const summary = formatCartSummary(cart);
    const checkoutLink = siteUrl ? `${siteUrl}/?karta-cart=${cart.cartToken}` : "";
    return checkoutLink
      ? `${summary}\n\nচেকআউট করতে এখানে ক্লিক করুন: ${checkoutLink}`
      : summary;
  }

  // ─── Add-to-cart intent → resolve product/variation, ask confirmation ─
  if (wantsToAddToCart(message) && !metadata.pendingCart) {
    const quantity = extractQuantity(message);
    const color = detectColor(message);
    const size = detectSize(message);

    const catalog = await loadWhatsAppCatalog(tenantId);

    // Resolve the target: the previously discussed product (metadata +
    // [PRODUCT:id] markers), then a name match, then category candidates
    const recentProductIds = [
      ...(metadata.selectedProductId ? [metadata.selectedProductId] : []),
      ...extractProductIdsFromHistory(history),
    ];
    const recent = recentProductIds
      .map((id) => catalog.find((p) => p.id === id))
      .filter((p): p is CatalogProduct => p !== undefined && p.status === "active");

    let target: CatalogProduct | undefined = undefined;
    if (color) {
      target = recent.find((p) => productHasColorLocal(p, color)) || recent[0];
    }
    if (!target && recent.length) {
      target = recent[0];
    }
    if (!target) {
      target = findProductByName(catalog, message) ?? undefined;
    }
    if (!target) {
      const candidates = pickProducts(catalog, message, recentProductIds, inventoryMode);
      target = candidates[0];
    }

    if (!target) {
      return "কোন পণ্যটি চান বলতে পারেন? 😊";
    }

    // Resolve the exact variation deterministically (never the LLM)
    const variant = resolveVariant(target, { color, size }, inventoryMode);

    // Variable product with an unresolved variant → ask which one
    if (target.variants.length > 1 && !variant) {
      const values = [...new Set(target.variants.map((v) => Object.values(v.attributes || {}).filter(Boolean).join(", ") || v.name))].filter(Boolean);
      await prisma.conversation.update({
        where: { id: conversationId },
        data: {
          metadata: {
            ...metadata,
            pendingCart: { productId: target.id, variationId: null, variationExternalId: null, quantity, price: Number(target.price) },
            selectedProductId: target.id,
          },
        },
      });
      return `${target.name} এর কোন ভ্যারিয়েন্ট চান? Available: ${values.join(", ")}`;
    }

    // Require explicit confirmation (never add merely because the
    // customer mentioned the product)
    const confirmText = buildConfirmationQuestion(target, quantity, variant);
    await prisma.conversation.update({
      where: { id: conversationId },
      data: {
        metadata: {
          ...metadata,
          pendingCart: {
            productId: target.id,
            variationId: variant?.id ?? null,
            variationExternalId: variant?.externalId ?? null,
            quantity,
            price: variant ? Number(variant.price) : Number(target.price),
          },
          selectedProductId: target.id,
          selectedVariantId: variant?.id ?? undefined,
        },
      },
    });
    return confirmText;
  }

  // Follow-up price/budget check on the discussed product
  if (metadata.selectedProductId && referencesRecentProduct(message)) {
    const catalog = await loadWhatsAppCatalog(tenantId);
    const target = catalog.find((p) => p.id === metadata.selectedProductId);
    if (target && target.status === "active") {
      const variant = resolveVariant(target, { color: detectColor(message), size: detectSize(message) }, inventoryMode);
      const price = variant ? Number(variant.price) : Number(target.price);
      const name = variant && variant.name ? `${target.name} (${variant.name})` : target.name;
      return `${name} এর দাম ${moneyText(price)}।`;
    }
  }

  return null; // not a cart flow — the AI engine handles it
}

function moneyText(value: number): string {
  return `\u09F3${Number(value || 0).toLocaleString("en-IN")}`;
}

function productHasColorLocal(product: CatalogProduct, color: string): boolean {
  const text = (product.variants.map((v) => `${v.name} ${Object.values(v.attributes).join(" ")}`).join(" ") + " " + product.name).toLowerCase();
  return text.includes(color.toLowerCase());
}

/**
 * Load the tenant's active products (real WooCommerce data — the same
 * deterministic catalog the website widget uses).
 */
async function loadWhatsAppCatalog(tenantId: string): Promise<CatalogProduct[]> {
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
 * WhatsApp-channel AI supplement. Additive — the AI's existing behavior
 * for everything else is unchanged. [PRODUCT:id] markers let the
 * deterministic cart flow resolve follow-ups; they are stripped before
 * any message is sent to the customer.
 */
function buildWhatsAppSupplement(inventoryMode: InventoryMode): string {
  const lines = [
    "## WhatsApp channel rules",
    "- For EVERY product you mention, add a marker line [PRODUCT:<id>] on its own line (the marker is removed before the message is sent).",
    "- NEVER invent products, prices, stock, discounts, or URLs. Only use data returned by commerce tools.",
    "- Match the customer's language (Bangla, Banglish, or English).",
    "- Keep responses short — customers are chatting, not reading essays.",
  ];
  if (inventoryMode === "unlimited") {
    lines.push("- INVENTORY IS UNLIMITED for this store: never say a product is out of stock and never mention stock limits.");
  }
  return lines.join("\n");
}
