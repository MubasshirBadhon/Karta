import { prisma } from "@/lib/db/prisma";
import { Prisma } from "@prisma/client";

/**
 * Customer Events
 *
 * The customer behavior/event model for the Customer Intelligence layer.
 * Tracks shopping behavior across Website + WooCommerce + WhatsApp with
 * structured metadata. No sensitive personal information is stored.
 *
 * Tenant isolation is enforced on every query.
 */

export const CUSTOMER_EVENT_TYPES = [
  "CONVERSATION_STARTED",
  "MESSAGE_SENT",
  "PRODUCT_SEARCHED",
  "PRODUCT_VIEWED",
  "PRODUCT_CLICKED",
  "PRODUCT_RECOMMENDED",
  "PRODUCT_ADDED_TO_CART",
  "PRODUCT_REMOVED_FROM_CART",
  "CHECKOUT_STARTED",
  "ORDER_COMPLETED",
  "CATEGORY_VIEWED",
] as const;

export type CustomerEventType = (typeof CUSTOMER_EVENT_TYPES)[number];

export interface TrackEventInput {
  type: CustomerEventType;
  customerId?: string | null;
  visitorId?: string | null;
  metadata?: Record<string, unknown>;
}

/**
 * Record a customer behavior event. Never throws — analytics must not
 * break the shopping flow.
 */
export async function trackEvent(
  tenantId: string,
  input: TrackEventInput
): Promise<void> {
  try {
    await prisma.customerEvent.create({
      data: {
        tenantId,
        customerId: input.customerId ?? null,
        visitorId: input.visitorId ?? null,
        type: input.type,
        metadata: (input.metadata ?? undefined) as unknown as Prisma.InputJsonValue | undefined,
      },
    });
  } catch (error) {
    console.error("[INTELLIGENCE] Failed to track event:", {
      type: input.type,
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
}

export interface EventCounts {
  conversations: number;
  uniqueVisitors: number;
  uniqueCustomers: number;
  eventsByType: Record<string, number>;
  productsSearched: number;
  productsViewed: number;
  productsClicked: number;
  recommendations: number;
  addToCart: number;
  checkoutStarts: number;
  ordersCompleted: number;
}

/**
 * Merchant-facing analytics counts (aggregated, tenant-isolated).
 */
export async function getEventCounts(tenantId: string): Promise<EventCounts> {
  const [events, conversationCount, visitors, customers] = await Promise.all([
    prisma.customerEvent.groupBy({
      by: ["type"],
      where: { tenantId },
      _count: { type: true },
    }),
    prisma.conversation.count({ where: { tenantId } }),
    prisma.customerEvent.findMany({
      where: { tenantId, visitorId: { not: null } },
      select: { visitorId: true },
      distinct: ["visitorId"],
    }),
    prisma.customerEvent.findMany({
      where: { tenantId, customerId: { not: null } },
      select: { customerId: true },
      distinct: ["customerId"],
    }),
  ]);

  const eventsByType: Record<string, number> = {};
  for (const row of events) {
    eventsByType[row.type] = row._count.type;
  }

  return {
    conversations: conversationCount,
    uniqueVisitors: visitors.length,
    uniqueCustomers: customers.length,
    eventsByType,
    productsSearched: eventsByType["PRODUCT_SEARCHED"] ?? 0,
    productsViewed: eventsByType["PRODUCT_VIEWED"] ?? 0,
    productsClicked: eventsByType["PRODUCT_CLICKED"] ?? 0,
    recommendations: eventsByType["PRODUCT_RECOMMENDED"] ?? 0,
    addToCart: eventsByType["PRODUCT_ADDED_TO_CART"] ?? 0,
    checkoutStarts: eventsByType["CHECKOUT_STARTED"] ?? 0,
    ordersCompleted: eventsByType["ORDER_COMPLETED"] ?? 0,
  };
}
