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
  conversationId: string;
  role: string;
  content: string;
  createdAt: Date;
}

/**
 * Get or create a conversation for a tenant on a specific channel.
 */
export async function getOrCreateConversation(
  tenantId: string,
  channel: string
): Promise<ConversationInfo> {
  const existing = await prisma.conversation.findFirst({
    where: {
      tenantId,
      channel,
      status: "active",
    },
    orderBy: { updatedAt: "desc" },
  });

  if (existing) {
    return existing;
  }

  const conversation = await prisma.conversation.create({
    data: {
      tenantId,
      channel,
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
  limit = 6
): Promise<AIMessage[]> {
  const messages = await prisma.message.findMany({
    where: { conversationId },
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  return messages.reverse().map((m) => ({
    role: m.role as AIMessage["role"],
    content: m.content,
  }));
}

/**
 * Save a message to the conversation.
 */
export function saveMessage(
  conversationId: string,
  role: "user" | "assistant" | "system",
  content: string
): Promise<MessageInfo> {
  return prisma.message.create({
    data: {
      conversationId,
      role,
      content,
    },
  });
}

/**
 * Get a conversation by ID.
 */
export function getConversation(
  conversationId: string
): Promise<ConversationInfo | null> {
  return prisma.conversation.findUnique({
    where: { id: conversationId },
  });
}
