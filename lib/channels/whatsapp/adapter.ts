import { prisma } from "@/lib/db/prisma";
import { createUnifiedMessage, type UnifiedMessage } from "@/lib/channels/types";
import { parseWhatsAppPayload, type ParsedWhatsAppMessage } from "./parser";
import type { WhatsAppWebhookPayload } from "./types";
import { normalizePhone } from "@/lib/intelligence/identity";
import { trackEvent } from "@/lib/intelligence/events";

/**
 * WhatsApp Channel Adapter
 *
 * Converts WhatsApp messages to UnifiedMessage and handles
 * tenant/customer/conversation resolution.
 */

/**
 * Resolve tenant from WhatsApp phone number ID.
 * Looks up the WhatsAppConnection to find the owning tenant.
 */
export async function resolveTenantByPhoneNumber(
  phoneNumberId: string
): Promise<{ tenantId: string; connectionId: string } | null> {
  const connection = await prisma.whatsAppConnection.findUnique({
    where: { phoneNumberId },
  });

  if (!connection || connection.status !== "active") {
    return null;
  }

  return {
    tenantId: connection.tenantId,
    connectionId: connection.id,
  };
}

/**
 * Get or create a customer for a WhatsApp phone number.
 * Uses tenantId + NORMALIZED phone as the logical customer identity:
 * the same phone → the same customer (same conversations, same behavior
 * history, same cart identity); a different phone → a different customer;
 * a different tenant → completely isolated.
 */
export async function getOrCreateCustomer(
  tenantId: string,
  phone: string,
  name?: string
): Promise<{ id: string }> {
  // Normalize the phone to a canonical form (E.164-ish)
  const normalized = normalizePhone(phone) || phone;

  // Look for existing customer by phone
  const existing = await prisma.customer.findFirst({
    where: {
      tenantId,
      phone: normalized,
    },
  });

  if (existing) {
    return existing;
  }

  // Create new customer
  const customer = await prisma.customer.create({
    data: {
      tenantId,
      phone: normalized,
      name: name || null,
      externalId: `wa_${normalized}`,
    },
  });

  return customer;
}

/**
 * Get or create a conversation for a WhatsApp customer.
 */
export async function getOrCreateWhatsAppConversation(
  tenantId: string,
  customerId: string
): Promise<{ id: string }> {
  // Look for existing active conversation
  const existing = await prisma.conversation.findFirst({
    where: {
      tenantId,
      customerId,
      channel: "whatsapp",
      status: "active",
    },
    orderBy: { updatedAt: "desc" },
  });

  if (existing) {
    return existing;
  }

  // Create new conversation
  const conversation = await prisma.conversation.create({
    data: {
      tenantId,
      customerId,
      channel: "whatsapp",
      status: "active",
    },
  });

  return conversation;
}

/**
 * Check if a message has already been processed (idempotency).
 */
export async function isMessageProcessed(
  externalMessageId: string
): Promise<boolean> {
  const existing = await prisma.message.findFirst({
    where: { externalId: externalMessageId },
  });
  return !!existing;
}

/**
 * Convert a parsed WhatsApp message to UnifiedMessage.
 * Resolves tenant, customer, and conversation.
 */
export async function toUnifiedMessage(
  parsed: ParsedWhatsAppMessage
): Promise<UnifiedMessage | null> {
  // Resolve tenant from phone number ID
  const tenantInfo = await resolveTenantByPhoneNumber(parsed.phoneNumberId);
  if (!tenantInfo) {
    return null;
  }

  // Get or create customer
  const customer = await getOrCreateCustomer(
    tenantInfo.tenantId,
    parsed.senderPhone,
    parsed.senderName
  );

  // Get or create conversation
  const conversation = await getOrCreateWhatsAppConversation(
    tenantInfo.tenantId,
    customer.id
  );

  return createUnifiedMessage({
    tenantId: tenantInfo.tenantId,
    channel: "whatsapp",
    text: parsed.text,
    conversationId: conversation.id,
    externalMessageId: parsed.externalMessageId,
    customerId: customer.id,
    timestamp: parsed.timestamp,
  });
}

/**
 * Process a WhatsApp webhook payload.
 * Returns an array of UnifiedMessages for text messages.
 */
export async function processWebhookPayload(
  payload: WhatsAppWebhookPayload
): Promise<UnifiedMessage[]> {
  const parsedMessages = parseWhatsAppPayload(payload);
  const unifiedMessages: UnifiedMessage[] = [];

  for (const parsed of parsedMessages) {
    // Check idempotency
    const alreadyProcessed = await isMessageProcessed(parsed.externalMessageId);
    if (alreadyProcessed) {
      continue;
    }

    const unified = await toUnifiedMessage(parsed);
    if (unified) {
      unifiedMessages.push(unified);
    }
  }

  return unifiedMessages;
}
