import { processMessage } from "@/lib/ai/commerce-engine";
import { getConversationHistory, saveMessage } from "@/lib/ai/conversation-service";
import { getWhatsAppProvider } from "./provider";
import type { UnifiedMessage } from "@/lib/channels/types";

/**
 * WhatsApp Message Processor
 *
 * Orchestrates the full flow from incoming WhatsApp message to AI response.
 * Reuses the existing AI commerce engine and commerce tools.
 *
 * Architecture:
 *   Inbound message → persist → AI engine → persist response → send via WhatsApp
 */

export interface ProcessResult {
  success: boolean;
  response?: string;
  error?: string;
  conversationId?: string;
  messageSent: boolean;
}

/**
 * Process an incoming WhatsApp message and send the AI response.
 * This is the main entry point for WhatsApp message handling.
 *
 * Flow:
 * 1. Persist inbound message
 * 2. Get conversation history
 * 3. Process through AI commerce engine
 * 4. Persist outbound message
 * 5. Send response via WhatsApp provider
 */
export async function processWhatsAppMessage(
  message: UnifiedMessage,
  senderPhone: string
): Promise<ProcessResult> {
  const logContext = {
    conversationId: message.conversationId,
    externalMessageId: message.externalMessageId,
    channel: message.channel,
  };

  try {
    // Step 1: Persist inbound message
    if (message.conversationId) {
      await saveMessage(message.conversationId, "customer", message.text);
    }

    // Step 2: Get conversation history for context
    const history = message.conversationId
      ? await getConversationHistory(message.conversationId)
      : [];

    // Step 3: Process through existing AI commerce engine
    const result = await processMessage(message, history);

    // Step 4: Persist outbound message
    if (result.text && message.conversationId) {
      await saveMessage(message.conversationId, "assistant", result.text);
    }

    // Step 5: Send response via WhatsApp
    let messageSent = false;
    if (result.text) {
      try {
        const provider = getWhatsAppProvider();
        await provider.sendTextMessage({
          phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID!,
          recipientPhone: senderPhone,
          text: result.text,
        });
        messageSent = true;
      } catch (sendError) {
        // Log safe error, don't expose internals
        console.error("WhatsApp send failed:", {
          ...logContext,
          error: sendError instanceof Error ? sendError.message : "Unknown error",
        });
        // Message is persisted even if send fails — allows retry/debugging
      }
    }

    return {
      success: result.success,
      response: result.text,
      conversationId: message.conversationId,
      messageSent,
    };
  } catch (error) {
    // Log sanitized error
    console.error("WhatsApp processing error:", {
      ...logContext,
      error: error instanceof Error ? error.message : "Unknown error",
    });

    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
      conversationId: message.conversationId,
      messageSent: false,
    };
  }
}
