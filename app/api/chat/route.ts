import { NextResponse } from "next/server";
import { z } from "zod";
import { processMessage } from "@/lib/ai/commerce-engine";
import {
  getOrCreateConversation,
  getConversationHistory,
  saveMessage,
  getConversation,
} from "@/lib/ai/conversation-service";
import { createUnifiedMessage } from "@/lib/channels/types";
import { prisma } from "@/lib/db/prisma";

// ─── Request Validation ───────────────────────────────────────

const ChatRequestSchema = z.object({
  conversationId: z.string().optional(),
  message: z.string().min(1).max(2000),
  siteToken: z.string().min(1).optional(), // Site-scoped token for tenant resolution
});

// ─── API Route ────────────────────────────────────────────────

/**
 * POST /api/chat
 *
 * Website AI chat endpoint.
 *
 * SECURITY: Tenant is resolved from a site-scoped token, NOT from
 * client-supplied tenantId. The site token is issued by Karta when
 * a merchant connects their store, and is scoped to a single tenant.
 *
 * For the investor demo, the site token can be obtained from the
 * Karta dashboard after connecting a WooCommerce store.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const parsed = ChatRequestSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request", details: parsed.error.errors },
        { status: 400 }
      );
    }

    const { conversationId, message, siteToken } = parsed.data;

    // Resolve tenant from site token
    // In production, this would validate the token against a SiteToken table
    // For the investor demo, we use a simple token-based lookup
    let tenantId: string | null = null;

    if (siteToken) {
      // Look up tenant by site token
      // This is a simplified implementation for the investor demo
      // In production, use a proper SiteToken table with expiration
      const connection = await prisma.wooCommerceConnection.findFirst({
        where: { connectionId: siteToken },
      });
      if (connection) {
        tenantId = connection.tenantId;
      }
    }

    // If no site token provided, check for a valid conversation ID
    if (!tenantId && conversationId) {
      const conversation = await getConversation(conversationId);
      if (conversation) {
        tenantId = conversation.tenantId;
      }
    }

    if (!tenantId) {
      return NextResponse.json(
        { error: "Unauthorized. Provide a valid site token or conversation ID." },
        { status: 401 }
      );
    }

    // Validate tenant exists
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
    });
    if (!tenant) {
      return NextResponse.json(
        { error: "Invalid tenant" },
        { status: 401 }
      );
    }

    // Get or create conversation
    const conversation = await getOrCreateConversation(tenantId);

    // If a conversationId was provided, validate it belongs to this tenant
    if (conversationId && conversationId !== conversation.id) {
      const providedConversation = await getConversation(conversationId);
      if (!providedConversation || providedConversation.tenantId !== tenantId) {
        return NextResponse.json(
          { error: "Invalid conversation" },
          { status: 401 }
        );
      }
    }

    // Save user message
    await saveMessage(conversation.id, "user", message);

    // Get conversation history
    const history = await getConversationHistory(conversation.id);

    // Create unified message
    const unifiedMessage = createUnifiedMessage({
      tenantId,
      channel: "web",
      text: message,
      conversationId: conversation.id,
    });

    // Process through AI engine
    const result = await processMessage(unifiedMessage, history);

    // Save assistant response
    if (result.text) {
      await saveMessage(conversation.id, "assistant", result.text);
    }

    return NextResponse.json({
      success: true,
      conversationId: conversation.id,
      response: result.text,
    });
  } catch {
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
