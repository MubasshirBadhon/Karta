import { AIProvider, AIRequest, AIResponse } from "./types";

/**
 * Groq AI Provider
 *
 * Implementation of the AIProvider interface using Groq's API.
 * The API key is read from the GROQ_API_KEY environment variable
 * and is only accessible server-side.
 */
export class GroqProvider implements AIProvider {
  private apiKey: string;
  private baseUrl = "https://api.groq.com/openai/v1";
  private defaultModel = "llama-3.3-70b-versatile";

  constructor() {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
      throw new Error(
        "GROQ_API_KEY is not set. Add it to your .env file."
      );
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

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Groq API error (${response.status}): ${errorText}`
      );
    }

    const data = await response.json();

    const choice = data.choices?.[0];
    if (!choice) {
      throw new Error("Groq API returned no choices");
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
