import { getAIProvider } from "@/lib/ai/provider";
import { getToolDefinitions, executeTool } from "@/lib/ai/commerce-tools";
import { COMMERCE_SYSTEM_PROMPT } from "@/lib/ai/system-prompt";
import { classifyProviderFailure } from "@/lib/ai/provider-error";
import { recordProviderFailure } from "@/lib/ai/circuit-breaker";
import type { UnifiedMessage } from "@/lib/channels/types";
import type { AIMessage } from "@/lib/ai/types";

/**
 * AI Commerce Engine
 *
 * Orchestrates the tool-calling loop between Groq and the commerce service.
 * The AI NEVER directly accesses the database — it only uses registered tools.
 *
 * Architecture:
 *   UnifiedMessage → AI Commerce Engine → Groq → Commerce Tools → Commerce Service → PostgreSQL
 */

const MAX_TOOL_ITERATIONS = 5;

export interface EngineResult {
  text: string;
  conversationId: string;
  toolCalls: ToolCallRecord[];
  success: boolean;
  error?: string;
  errorDetails?: string;
  /** Sanitized provider error classification (AI_PROVIDER_RATE_LIMITED, ...) */
  errorCode?: string;
}

export interface ToolCallRecord {
  toolName: string;
  arguments: unknown;
  result: unknown;
}

/**
 * Process a customer message through the AI commerce engine.
 *
 * The optional `options.extraSystem` appends website-specific context to
 * the system prompt (e.g. deterministic product candidates). Existing
 * callers (WhatsApp) that do not pass options are unaffected.
 */
export async function processMessage(
  message: UnifiedMessage,
  conversationHistory: AIMessage[] = [],
  options?: { extraSystem?: string }
): Promise<EngineResult> {
  const provider = getAIProvider();
  const toolCalls: ToolCallRecord[] = [];

  const systemContent = options?.extraSystem
    ? `${COMMERCE_SYSTEM_PROMPT}\n\n${options.extraSystem}`
    : COMMERCE_SYSTEM_PROMPT;

  // Build message history
  const messages: AIMessage[] = [
    { role: "system", content: systemContent },
    ...conversationHistory,
    { role: "user", content: message.text },
  ];

  try {
    // Tool-calling loop
    for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
      const response = await provider.generateResponse({
        messages,
        tools: getToolDefinitions(),
        temperature: 0.3,
        maxTokens: 1024,
      });

      // If no tool calls, we have the final response
      if (!response.toolCalls || response.toolCalls.length === 0) {
        return {
          text: response.content,
          conversationId: message.conversationId || "",
          toolCalls,
          success: true,
        };
      }

      // Execute tool calls and add results to messages
      const newMessages: AIMessage[] = [...messages];
      // Include the assistant message WITH tool_calls so Groq can correlate
      // tool results with the calls (required by OpenAI-compatible APIs)
      if (response.content || response.toolCalls) {
        newMessages.push({
          role: "assistant",
          content: response.content,
          toolCalls: response.toolCalls,
        });
      }

      for (const toolCall of response.toolCalls) {
        const args = JSON.parse(toolCall.function.arguments);

        let result: unknown;
        try {
          result = await executeTool(message.tenantId, toolCall.function.name, args);
        } catch (error) {
          result = {
            error: error instanceof Error ? error.message : "Tool execution failed",
          };
        }

        toolCalls.push({
          toolName: toolCall.function.name,
          arguments: args,
          result,
        });

        newMessages.push({
          role: "tool",
          content: JSON.stringify(result),
          toolCallId: toolCall.id,
        });
      }

      // Update messages for next iteration
      messages.length = 0;
      messages.push(...newMessages);
    }

    // If we hit the iteration limit, return a graceful message
    return {
      text: "I'm having trouble processing that request. Could you try rephrasing your question?",
      conversationId: message.conversationId || "",
      toolCalls,
      success: true,
    };
  } catch (error) {
    // Classify the provider failure WITHOUT exposing secrets: 429 →
    // AI_PROVIDER_RATE_LIMITED, 401/403 → auth, 5xx → unavailable, etc.
    // Record it in the circuit breaker so bursts of customer messages
    // do not create bursts of doomed provider calls.
    const providerError = classifyProviderFailure(error);
    recordProviderFailure(providerError.code, providerError.retryAfterMs);
    console.error("[AI Provider]", {
      code: providerError.code,
      status: providerError.status ?? null,
    });

    return {
      text: "Sorry, I'm experiencing some technical difficulties. Please try again in a moment.",
      conversationId: message.conversationId || "",
      toolCalls,
      success: false,
      error: providerError.message,
      errorDetails: error instanceof Error ? error.stack : undefined,
      errorCode: providerError.code,
    };
  }
}
