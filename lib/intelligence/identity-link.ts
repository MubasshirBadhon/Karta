import { randomBytes } from "crypto";
import { prisma } from "@/lib/db/prisma";
import { normalizePhone } from "./identity";

/**
 * Identity Linking (anonymous → WooCommerce customer merge)
 *
 * When an anonymous website visitor later becomes a WooCommerce customer,
 * their first-party visitor identity is linked to the WooCommerce
 * customer identity:
 *
 *   anonymous visitor (kvid_...)
 *        ↓
 *   WooCommerce customer ID / email / phone
 *        ↓
 *   merge → one Karta Customer record
 *        ↓
 *   previous conversation history is PRESERVED (never discarded)
 *
 * Rules:
 * - Identities are only linked on RELIABLE, AUTHORIZED signals: a real
 *   WooCommerce customer ID, a verified email, or a normalized phone —
 *   never guessed from weak signals (IP, user agent, timing).
 * - Only a caller authorized with the WooCommerce connection secret can
 *   trigger a link (the endpoint is HMAC-authenticated).
 * - The visitor's previous conversations are re-linked to the merged
 *   customer so the full history stays available.
 * - Tenant isolation is enforced everywhere.
 */

export interface LinkIdentityInput {
  visitorId?: string | null;
  wooCustomerId?: string | null;
  email?: string | null;
  phone?: string | null;
  name?: string | null;
}

export interface LinkIdentityResult {
  success: boolean;
  customerId?: string;
  linked: boolean;
  linkedConversations: number;
  error?: string;
}

export async function linkVisitorToCustomer(
  tenantId: string,
  input: LinkIdentityInput
): Promise<LinkIdentityResult> {
  const visitorId = input.visitorId || null;
  const wooCustomerId = input.wooCustomerId || null;
  const email = input.email || null;
  const phone = input.phone ? normalizePhone(input.phone) : null;

  // A link requires at least one reliable signal
  if (!wooCustomerId && !email && !phone) {
    return { success: false, linked: false, linkedConversations: 0, error: "A reliable identity signal is required (Woo customer ID, email, or phone)" };
  }

  try {
    // ─── Find or create the Customer record ─────────────────
    let customer = null as { id: string } | null;

    if (wooCustomerId) {
      customer = await prisma.customer.findFirst({
        where: { tenantId, externalId: wooCustomerId },
        select: { id: true },
      });
    }
    if (!customer && email) {
      customer = await prisma.customer.findFirst({
        where: { tenantId, email },
        select: { id: true },
      });
    }
    if (!customer && phone) {
      customer = await prisma.customer.findFirst({
        where: { tenantId, phone },
        select: { id: true },
      });
    }

    if (customer) {
      // Merge: link the visitor identity + fill in any missing fields
      const existing = await prisma.customer.findUnique({ where: { id: customer.id } });
      await prisma.customer.update({
        where: { id: customer.id },
        data: {
          visitorId: visitorId ?? existing?.visitorId ?? undefined,
          externalId: wooCustomerId ?? existing?.externalId ?? undefined,
          email: email ?? undefined,
          phone: phone ?? undefined,
          name: input.name ?? undefined,
        },
      });
    } else {
      const created = await prisma.customer.create({
        data: {
          tenantId,
          visitorId,
          externalId: wooCustomerId,
          email,
          phone,
          name: input.name || null,
        },
      });
      customer = { id: created.id };
    }

    // ─── Preserve history: re-link the visitor's conversations ──
    // The anonymous conversations keep their messages; they now belong
    // to the merged customer identity.
    const linkedConversations = visitorId
      ? await prisma.conversation.updateMany({
          where: { tenantId, visitorId, customerId: null },
          data: { customerId: customer.id },
        })
      : { count: 0 };

    return {
      success: true,
      customerId: customer.id,
      linked: true,
      linkedConversations: linkedConversations.count,
    };
  } catch (error) {
    console.error("[INTELLIGENCE] Identity link failed:", error);
    return {
      success: false,
      linked: false,
      linkedConversations: 0,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Generate a link token (used for cart-restore style flows).
 */
export function generateLinkToken(): string {
  return randomBytes(16).toString("hex");
}
