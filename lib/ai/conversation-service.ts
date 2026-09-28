import { prisma } from "@/lib/db/prisma";
import type { AIMessage } from "@/lib/ai/types";

/**
 * Conversation Service
 *
 * Handles persistence of conversations and messages.
 * Uses the existing Prisma models: Conversation, Message, Customer.
 */

export interface ConversationInfo {
  id: string;
  tenantId: string;
  channel: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface MessageInfo {
  id: string;
  role: string;
  content: string;
  createdAt: Date;
}

/**
 * Get or create a conversation for a tenant on the web channel.
 */
export async function getOrCreateConversation(
  tenantId: string,
  customerId?: string | null
): Promise<ConversationInfo> {
  // Look for an active conversation for this tenant
  const existing = await prisma.conversation.findFirst({
    where: {
      tenantId,
      channel: "web",
      status: "active",
    },
    orderBy: { updatedAt: "desc" },
  });

  if (existing) {
    return existing;
  }

  // Create a new conversation
  const conversation = await prisma.conversation.create({
    data: {
      tenantId,
      customerId: customerId || null,
      channel: "web",
      status: "active",
    },
  });

  return conversation;
}

/**
 * Get conversation history formatted for the AI engine.
 */
export async function getConversationHistory(
  conversationId: string,
  limit = 20
): Promise<AIMessage[]> {
  const messages = await prisma.message.findMany({
    where: { conversationId },
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  // Reverse to get chronological order and map to AIMessage format
  return messages.reverse().map((m) => ({
    role: m.role as "user" | "assistant" | "system",
    content: m.content,
  }));
}

/**
 * Save a message to the conversation.
 */
export async function saveMessage(
  conversationId: string,
  role: "user" | "assistant" | "system" | "customer",
  content: string
): Promise<MessageInfo> {
  const message = await prisma.message.create({
    data: {
      conversationId,
      role,
      content,
    },
  });

  // Update conversation timestamp
  await prisma.conversation.update({
    where: { id: conversationId },
    data: { updatedAt: new Date() },
  });

  return message;
}

/**
 * Get a conversation by ID.
 */
export async function getConversation(
  conversationId: string
): Promise<ConversationInfo | null> {
  return prisma.conversation.findUnique({
    where: { id: conversationId },
  });
}
