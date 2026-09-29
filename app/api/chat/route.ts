import { NextResponse } from "next/server";
import { processMessage } from "@/lib/ai/commerce-engine";
import {
  getOrCreateConversation,
  getConversationHistory,
  saveMessage,
} from "@/lib/ai/conversation-service";
import { prisma } from "@/lib/db/prisma";

/**
 * POST /api/chat
 *
 * Website AI chat endpoint.
 *
 * Request body:
 * {
 *   "message": "string",
 *   "conversationId": "string" (optional)
 * }
 *
 * Response:
 * {
 *   "success": true,
 *   "conversationId": "string",
 *   "response": "string"
 * }
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { message, conversationId: providedConversationId } = body;

    if (!message || typeof message !== "string") {
      return NextResponse.json(
        { error: "Message is required" },
        { status: 400 }
    );
    }

    // Get the first tenant (for demo purposes)
    const tenant = await prisma.tenant.findFirst({
      orderBy: { createdAt: "asc" },
    });

    if (!tenant) {
      return NextResponse.json(
        { error: "No tenant configured" },
        { status: 500 }
      );
    }

    // Get or create conversation
    const conversation = providedConversationId
      ? await prisma.conversation.findUnique({
          where: { id: providedConversationId },
        })
      : await getOrCreateConversation(tenant.id, "web");

    if (!conversation) {
      return NextResponse.json(
        { error: "Invalid conversation" },
        { status: 401 }
      );
    }

    // Save user message
    await saveMessage(conversation.id, "user", message);

    // Get conversation history
    const history = await getConversationHistory(conversation.id);

    // Process through AI engine
    const result = await processMessage(
      {
        tenantId: tenant.id,
        channel: "web",
        conversationId: conversation.id,
        text: message,
        timestamp: new Date().toISOString(),
      },
      history
    );

    // Safe server-side error logging (no secrets exposed)
    if (!result.success) {
      console.error("[CHAT AI ERROR]", JSON.stringify({
        error: result.error,
        conversationId: conversation.id,
        historyLength: history.length,
        timestamp: new Date().toISOString(),
      }));
    }

    // Safe server-side error logging (no secrets exposed)
    if (!result.success) {
      console.error("[CHAT AI ERROR]", JSON.stringify({
        error: result.error,
        conversationId: conversation.id,
        historyLength: history.length,
        timestamp: new Date().toISOString(),
      }));
    }

    // Safe server-side error logging (no secrets exposed)
    if (!result.success) {
      console.error("[CHAT AI ERROR]", JSON.stringify({
        error: result.error,
        conversationId: conversation.id,
        historyLength: history.length,
        timestamp: new Date().toISOString(),
      }));
    }

    // Safe server-side error logging (no secrets exposed)
    if (!result.success) {
      console.error("[CHAT AI ERROR]", JSON.stringify({
        error: result.error,
        conversationId: conversation.id,
        historyLength: history.length,
        timestamp: new Date().toISOString(),
      }));
    }

    // Safe server-side error logging (no secrets exposed)
    if (!result.success) {
      console.error("[CHAT AI ERROR]", JSON.stringify({
        error: result.error,
        conversationId: conversation.id,
        historyLength: history.length,
        timestamp: new Date().toISOString(),
      }));
    }

    // Safe server-side error logging (no secrets exposed)
    if (!result.success) {
      console.error("[CHAT AI ERROR]", JSON.stringify({
        error: result.error,
        conversationId: conversation.id,
        historyLength: history.length,
        timestamp: new Date().toISOString(),
      }));
    }

    // Safe server-side error logging (no secrets exposed)
    if (!result.success) {
      console.error("[CHAT AI ERROR]", JSON.stringify({
        error: result.error,
        conversationId: conversation.id,
        historyLength: history.length,
        timestamp: new Date().toISOString(),
      }));
    }

    // Safe server-side error logging (no secrets exposed)
    if (!result.success) {
      console.error("[CHAT AI ERROR]", JSON.stringify({
        error: result.error,
        conversationId: conversation.id,
        historyLength: history.length,
        timestamp: new Date().toISOString(),
      }));
    }

    // Safe server-side error logging (no secrets exposed)
    if (!result.success) {
      console.error("[CHAT AI ERROR]", JSON.stringify({
        error: result.error,
        conversationId: conversation.id,
        historyLength: history.length,
        timestamp: new Date().toISOString(),
      }));
    }

    // Safe server-side error logging (no secrets exposed)
    if (!result.success) {
      console.error("[CHAT AI ERROR]", JSON.stringify({
        error: result.error,
        conversationId: conversation.id,
        historyLength: history.length,
        timestamp: new Date().toISOString(),
      }));
    }

    // Safe server-side error logging (no secrets exposed)
    if (!result.success) {
      console.error("[CHAT AI ERROR]", JSON.stringify({
        error: result.error,
        conversationId: conversation.id,
        historyLength: history.length,
        timestamp: new Date().toISOString(),
      }));
    }

    // Safe server-side error logging (no secrets exposed)
    if (!result.success) {
      console.error("[CHAT AI ERROR]", JSON.stringify({
        error: result.error,
        conversationId: conversation.id,
        historyLength: history.length,
        timestamp: new Date().toISOString(),
      }));
    }

    // Safe server-side error logging (no secrets exposed)
    if (!result.success) {
      console.error("[CHAT AI ERROR]", JSON.stringify({
        error: result.error,
        conversationId: conversation.id,
        historyLength: history.length,
        timestamp: new Date().toISOString(),
      }));
    }

    // Safe server-side error logging (no secrets exposed)
    if (!result.success) {
      console.error("[CHAT AI ERROR]", JSON.stringify({
        error: result.error,
        conversationId: conversation.id,
        historyLength: history.length,
        timestamp: new Date().toISOString(),
      }));
    }

    // Safe server-side error logging (no secrets exposed)
    if (!result.success) {
      console.error("[CHAT AI ERROR]", JSON.stringify({
        error: result.error,
        conversationId: conversation.id,
        historyLength: history.length,
        timestamp: new Date().toISOString(),
      }));
    }

    // Safe server-side error logging (no secrets exposed)
    if (!result.success) {
      console.error("[CHAT AI ERROR]", JSON.stringify({
        error: result.error,
        conversationId: conversation.id,
        historyLength: history.length,
        timestamp: new Date().toISOString(),
      }));
    }

    // Safe server-side error logging (no secrets exposed)
    if (!result.success) {
      console.error("[CHAT AI ERROR]", JSON.stringify({
        error: result.error,
        conversationId: conversation.id,
        historyLength: history.length,
        timestamp: new Date().toISOString(),
      }));
    }

    // Safe server-side error logging (no secrets exposed)
    if (!result.success) {
      console.error("[CHAT AI ERROR]", JSON.stringify({
        error: result.error,
        conversationId: conversation.id,
        historyLength: history.length,
        timestamp: new Date().toISOString(),
      }));
    }

    // Safe server-side error logging (no secrets exposed)
    if (!result.success) {
      console.error("[CHAT AI ERROR]", JSON.stringify({
        error: result.error,
        conversationId: conversation.id,
        historyLength: history.length,
        timestamp: new Date().toISOString(),
      }));
    }

    // Safe server-side error logging (no secrets exposed)
    if (!result.success) {
      console.error("[CHAT AI ERROR]", JSON.stringify({
        error: result.error,
        conversationId: conversation.id,
        historyLength: history.length,
        timestamp: new Date().toISOString(),
      }));
    }

    // Safe server-side error logging (no secrets exposed)
    if (!result.success) {
      console.error("[CHAT AI ERROR]", JSON.stringify({
        error: result.error,
        conversationId: conversation.id,
        historyLength: history.length,
        timestamp: new Date().toISOString(),
      }));
    }

    // Safe server-side error logging (no secrets exposed)
    if (!result.success) {
      console.error("[CHAT AI ERROR]", JSON.stringify({
        error: result.error,
        conversationId: conversation.id,
        historyLength: history.length,
        timestamp: new Date().toISOString(),
      }));
    }

    // Safe server-side error logging (no secrets exposed)
    if (!result.success) {
      console.error("[CHAT AI ERROR]", JSON.stringify({
        error: result.error,
        conversationId: conversation.id,
        historyLength: history.length,
        timestamp: new Date().toISOString(),
      }));
    }

    // Save assistant response
    if (result.text) {
      await saveMessage(conversation.id, "assistant", result.text);
    }

    return NextResponse.json({
      success: true,
      conversationId: conversation.id,
      response: result.text,
    });
  } catch (error) {
    console.error("Chat API error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
