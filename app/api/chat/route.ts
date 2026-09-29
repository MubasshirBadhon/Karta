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
  const diagStart = Date.now();
  const diagLog = (msg: string, data?: Record<string, unknown>) => {
    console.log(`[CHAT DIAG] ${msg}`, data ? JSON.stringify(data) : "");
  };

  try {
    diagLog("Request received");

    const body = await request.json();
    const parsed = ChatRequestSchema.safeParse(body);

    if (!parsed.success) {
      diagLog("Validation failed", { errors: parsed.error.errors });
      return NextResponse.json(
        { error: "Invalid request", details: parsed.error.errors },
        { status: 400 }
      );
    }

    const { conversationId, message, siteToken } = parsed.data;
    diagLog("Parsed body", { hasConversationId: !!conversationId, messageLength: message.length, hasSiteToken: !!siteToken });

    // Resolve tenant
    // Priority 1: Site token from authenticated WordPress connection
    // Priority 2: Conversation ID from existing session
    // Priority 3 (Demo): Resolve directly to Karta Demo Store tenant
    let tenantId: string | null = null;

    if (siteToken) {
      diagLog("Looking up tenant by site token", { siteTokenPrefix: siteToken.substring(0, 8) });
      const connection = await prisma.wooCommerceConnection.findFirst({
        where: { connectionId: siteToken },
      });
      if (connection) {
        tenantId = connection.tenantId;
        diagLog("Tenant found from site token", { tenantId });
      } else {
        diagLog("No connection found for site token");
      }
    }

    // If no site token provided, check for a valid conversation ID
    if (!tenantId && conversationId) {
      diagLog("Looking up tenant by conversation ID");
      const conversation = await getConversation(conversationId);
      if (conversation) {
        tenantId = conversation.tenantId;
        diagLog("Tenant found from conversation", { tenantId });
      } else {
        diagLog("No conversation found");
      }
    }

    // Demo mode: Resolve directly to Karta Demo Store tenant
    // This allows /demo/chat to work without requiring NEXT_PUBLIC_DEMO_SITE_TOKEN
    if (!tenantId) {
      diagLog("No siteToken or conversationId provided - resolving to Karta Demo Store");
      const demoTenant = await prisma.tenant.findUnique({
        where: { slug: "karta-demo-store" },
      });
      if (demoTenant) {
        tenantId = demoTenant.id;
        diagLog("Demo tenant resolved", { tenantId });
      } else {
        diagLog("Demo tenant not found - returning 401");
        return NextResponse.json(
          { error: "Demo tenant not found. Please run the database seed first." },
          { status: 401 }
        );
      }
    }

    // Validate tenant exists
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
    });
    if (!tenant) {
      diagLog("Tenant not found in database");
      return NextResponse.json(
        { error: "Invalid tenant" },
        { status: 401 }
      );
    }
    diagLog("Tenant validated");

    // Get or create conversation
    const conversation = await getOrCreateConversation(tenantId);
    diagLog("Conversation ready", { conversationId: conversation.id });

    // If a conversationId was provided, validate it belongs to this tenant
    if (conversationId && conversationId !== conversation.id) {
      const providedConversation = await getConversation(conversationId);
      if (!providedConversation || providedConversation.tenantId !== tenantId) {
        diagLog("Conversation ownership validation failed");
        return NextResponse.json(
          { error: "Invalid conversation" },
          { status: 401 }
        );
      }
    }

    // Save user message
    await saveMessage(conversation.id, "user", message);
    diagLog("User message saved");

    // Get conversation history
    const history = await getConversationHistory(conversation.id);
    diagLog("History retrieved", { historyLength: history.length });

    // Create unified message
    const unifiedMessage = createUnifiedMessage({
      tenantId,
      channel: "web",
      text: message,
      conversationId: conversation.id,
    });

    // Process through AI engine
    diagLog("Starting AI processing");
    const result = await processMessage(unifiedMessage, history);
    diagLog("AI processing completed", { success: result.success, responseLength: result.text.length });

    // Save assistant response
    if (result.text) {
      await saveMessage(conversation.id, "assistant", result.text);
      diagLog("Assistant response saved");
    }

    diagLog("Request completed", { elapsedMs: Date.now() - diagStart });

    return NextResponse.json({
      success: true,
      conversationId: conversation.id,
      response: result.text,
    });
  } catch (error) {
    console.error("[CHAT DIAG] Error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
