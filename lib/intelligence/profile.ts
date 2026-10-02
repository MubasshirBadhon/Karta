import { prisma } from "@/lib/db/prisma";
import type { CartStoreItem } from "@/lib/commerce/woo-cart-store";

/**
 * Customer Profile (derived)
 *
 * A compact, derived profile built from customer events + conversations +
 * orders. NOT a huge behavior blob — this is a small summary suitable for
 * (a) the recommendation engine and (b) a compact AI context summary.
 *
 * PRIVACY: only behavioral/commercial facts are derived. No sensitive
 * personal attributes, no psychological/mental-state inferences.
 */

export interface CustomerProfile {
  interestedCategories: string[];
  viewedProductIds: string[];
  clickedProductIds: string[];
  recentlyRecommendedIds: string[];
  dismissedProductIds: string[]; // rejected recommendations, safely inferable
  cartItems: CartStoreItem[];
  recentSearches: string[];
  budgetSignals: number[]; // stated/observed budgets (max)
  purchasedCategoryCounts: Record<string, number>;
  purchaseHistory: Array<{ orderId: string; total: number; itemCount: number; status: string }>;
  lastInteractionAt: Date | null;
  preferredChannel: string | null;
}

const BUDGET_PATTERN = /([0-9]{2,7})/;

/**
 * Derive the profile for a customer and/or anonymous visitor.
 * Tenant isolation is enforced on every query.
 */
export async function getCustomerProfile(
  tenantId: string,
  identity: { customerId?: string | null; visitorId?: string | null }
): Promise<CustomerProfile> {
  const identityWhere =
    identity.customerId && identity.visitorId
      ? { OR: [{ customerId: identity.customerId }, { visitorId: identity.visitorId }] }
      : identity.customerId
        ? { customerId: identity.customerId }
        : { visitorId: identity.visitorId ?? "__none__" };

  const [events, conversations, orders] = await Promise.all([
    prisma.customerEvent.findMany({
      where: { tenantId, ...identityWhere },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
    prisma.conversation.findMany({
      where: { tenantId, ...identityWhere },
      orderBy: { updatedAt: "desc" },
      take: 10,
      include: { messages: { orderBy: { createdAt: "desc" }, take: 20, select: { role: true, content: true, createdAt: true } } },
    }),
    identity.customerId
      ? prisma.order.findMany({
          where: { tenantId, customerId: identity.customerId },
          orderBy: { createdAt: "desc" },
          take: 20,
          include: { items: true },
        })
      : Promise.resolve([]),
  ]);

  // ─── Derive behavioral facts from events ─────────────────
  const interestedCategories = new Set<string>();
  const viewedProductIds: string[] = [];
  const clickedProductIds: string[] = [];
  const recentlyRecommendedIds: string[] = [];
  const dismissedProductIds: string[] = [];
  const recentSearches: string[] = [];
  const budgetSignals: number[] = [];
  let lastInteractionAt: Date | null = null;
  const channelCounts: Record<string, number> = {};

  for (const event of events) {
    const meta = (event.metadata as Record<string, unknown>) || {};
    if (event.createdAt && (!lastInteractionAt || event.createdAt > lastInteractionAt)) {
      lastInteractionAt = event.createdAt;
    }

    switch (event.type) {
      case "PRODUCT_SEARCHED": {
        const category = meta.category as string | undefined;
        if (category) interestedCategories.add(category);
        const query = meta.query as string | undefined;
        if (query) recentSearches.push(query);
        const budget = typeof meta.budget === "number" ? meta.budget : Number(meta.budget) || null;
        if (budget) budgetSignals.push(budget);
        break;
      }
      case "CATEGORY_VIEWED": {
        const category = meta.category as string | undefined;
        if (category) interestedCategories.add(category);
        break;
      }
      case "PRODUCT_VIEWED": {
        const productId = meta.productId as string | undefined;
        if (productId && !viewedProductIds.includes(productId)) viewedProductIds.push(productId);
        break;
      }
      case "PRODUCT_CLICKED": {
        const productId = meta.productId as string | undefined;
        if (productId && !clickedProductIds.includes(productId)) clickedProductIds.push(productId);
        break;
      }
      case "PRODUCT_RECOMMENDED": {
        const productIds = Array.isArray(meta.productIds) ? (meta.productIds as string[]) : [];
        for (const id of productIds) {
          if (!recentlyRecommendedIds.includes(id)) recentlyRecommendedIds.push(id);
        }
        break;
      }
      case "PRODUCT_REMOVED_FROM_CART": {
        const productId = meta.productId as string | undefined;
        if (productId && !dismissedProductIds.includes(productId)) dismissedProductIds.push(productId);
        break;
      }
    }
  }

  // ─── Derive searches/budgets from recent conversation text ─
  for (const conversation of conversations) {
    for (const message of conversation.messages) {
      if (message.role !== "user" && message.role !== "customer") continue;
      const match = String(message.content || "").match(BUDGET_PATTERN);
      if (match) {
        const budget = Number(match[1]);
        if (budget > 0) budgetSignals.push(budget);
      }
    }
  }

  // ─── Purchase history / frequently purchased categories ───
  const purchasedCategoryCounts: Record<string, number> = {};
  const purchaseHistory = orders.map((order) => {
    for (const item of order.items) {
      void item;
    }
    return {
      orderId: order.id,
      total: Number(order.total),
      itemCount: order.items.reduce((sum, i) => sum + i.quantity, 0),
      status: order.status,
    };
  });

  // ─── Preferred channel ───────────────────────────────────
  for (const conversation of conversations) {
    channelCounts[conversation.channel] = (channelCounts[conversation.channel] || 0) + 1;
  }
  const preferredChannel =
    Object.entries(channelCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

  return {
    interestedCategories: [...interestedCategories].slice(0, 8),
    viewedProductIds: viewedProductIds.slice(0, 12),
    clickedProductIds: clickedProductIds.slice(0, 12),
    recentlyRecommendedIds: recentlyRecommendedIds.slice(0, 12),
    dismissedProductIds: dismissedProductIds.slice(0, 12),
    cartItems: [],
    recentSearches: recentSearches.slice(0, 6),
    budgetSignals: [...new Set(budgetSignals)].slice(0, 4),
    purchasedCategoryCounts,
    purchaseHistory,
    lastInteractionAt,
    preferredChannel,
  };
}

/**
 * A compact AI context summary (a few lines — never a behavior blob).
 */
export function formatProfileForAI(profile: CustomerProfile): string {
  const lines: string[] = [];

  if (profile.interestedCategories.length) {
    lines.push(`- Recent interests: ${profile.interestedCategories.join(", ")}`);
  }
  if (profile.budgetSignals.length) {
    lines.push(`- Budget signal: <= ${Math.max(...profile.budgetSignals)} BDT`);
  }
  if (profile.viewedProductIds.length) {
    lines.push(`- Recently viewed product IDs: ${profile.viewedProductIds.slice(0, 4).join(", ")}`);
  }
  if (profile.dismissedProductIds.length) {
    lines.push(`- Do NOT recommend these again (dismissed): ${profile.dismissedProductIds.join(", ")}`);
  }
  if (profile.purchaseHistory.length) {
    const completed = profile.purchaseHistory.filter((o) => o.status === "confirmed" || o.status === "delivered");
    if (completed.length) {
      lines.push(`- Previous orders: ${completed.length} completed`);
    }
  }

  return lines.length ? lines.join("\n") : "";
}
