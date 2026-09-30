import { AIProvider, AIRequest, AIResponse } from "./types";
import { classifyProviderFailure } from "./provider-error";

/**
 * Groq AI Provider
 *
 * Implementation of the AIProvider interface using Groq's API.
 * The API key is read from the GROQ_API_KEY environment variable
 * and is only accessible server-side.
 *
 * NOTE ON MULTIPLE KEYS: This implementation works correctly with ONE
 * Groq key. Additional keys can be configured later via the provider
 * abstraction (see provider.ts), but do NOT assume each key multiplies
 * the free-tier limit — rate limits are typically per ORGANIZATION,
 * so multiple keys from the same organization share one quota.
 */
export class GroqProvider implements AIProvider {
  private apiKey: string;
  private baseUrl = "https://api.groq.com/openai/v1";
  private defaultModel = "openai/gpt-oss-120b";

  constructor() {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
      const error = new Error(
        "GROQ_API_KEY is not set. Add it to your .env file."
      ) as Error & { code: string };
      error.code = "AI_PROVIDER_NO_KEY";
      throw error;
    }
    this.apiKey = apiKey;
  }

  async generateResponse(input: AIRequest): Promise<AIResponse> {
    const body: Record<string, unknown> = {
      model: process.env.GROQ_MODEL || this.defaultModel,
      messages: input.messages.map((m) => ({
        role: m.role,
        content: m.content,
        ...(m.toolCalls && { tool_calls: m.toolCalls }),
        ...(m.toolCallId && { tool_call_id: m.toolCallId }),
      })),
      temperature: input.temperature ?? 0.7,
      max_tokens: input.maxTokens ?? 1024,
    };

    if (input.tools && input.tools.length > 0) {
      body.tools = input.tools;
    }

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
      });
    } catch (error) {
      // Network failure or timeout — classified, no secrets in the message
      throw classifyProviderFailure(error);
    }

    if (!response.ok) {
      const errorText = await response.text();
      const retryAfter = response.headers.get("retry-after");

      // Log sanitized provider status server-side (status + retry-after
      // only — never the API key, request bodies, or provider internals).
      // Rate-limit headers are read but NOT exposed to the browser.
      console.error("[AI Provider]", {
        status: response.status,
        retryAfter: retryAfter ?? null,
        rateLimitRemaining: response.headers.get("x-ratelimit-remaining-requests") ?? null,
      });

      throw classifyProviderFailure(new Error(`Groq API error (${response.status}): ${errorText.slice(0, 200)}`), {
        status: response.status,
        retryAfter,
      });
    }

    const data = await response.json();

    const choice = data.choices?.[0];
    if (!choice) {
      throw classifyProviderFailure(new Error("Groq API returned no choices"));
    }

    const message = choice.message;

    return {
      content: message.content || "",
      toolCalls: message.tool_calls?.map((tc: Record<string, unknown>) => ({
        id: tc.id as string,
        type: "function" as const,
        function: {
          name: (tc.function as Record<string, string>).name,
          arguments: (tc.function as Record<string, string>).arguments,
        },
      })),
      usage: data.usage
        ? {
            promptTokens: data.usage.prompt_tokens,
            completionTokens: data.usage.completion_tokens,
            totalTokens: data.usage.total_tokens,
          }
        : undefined,
    };
  }
}
