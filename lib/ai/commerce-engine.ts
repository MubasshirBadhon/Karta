import { getAIProvider } from "@/lib/ai/provider";
import { getToolDefinitions, executeTool } from "@/lib/ai/commerce-tools";
import { COMMERCE_SYSTEM_PROMPT } from "@/lib/ai/system-prompt";
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
}

export interface ToolCallRecord {
  toolName: string;
  arguments: unknown;
  result: unknown;
}

/**
 * Process a customer message through the AI commerce engine.
 */
export async function processMessage(
  message: UnifiedMessage,
  conversationHistory: AIMessage[] = []
): Promise<EngineResult> {
  const provider = getAIProvider();
  const toolCalls: ToolCallRecord[] = [];

  // Build message history
  const messages: AIMessage[] = [
    { role: "system", content: COMMERCE_SYSTEM_PROMPT },
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
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error("AI Engine error:", errorMessage);

    return {
      text: "Sorry, I'm experiencing some technical difficulties. Please try again in a moment.",
      conversationId: message.conversationId || "",
      toolCalls,
      success: false,
      error: errorMessage,
      errorDetails: error instanceof Error ? error.stack : undefined,
    };
  }
}
