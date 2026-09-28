import { AIProvider, AIRequest, AIResponse } from "./types";
import { GroqProvider } from "./groq";

/**
 * AI Provider Factory
 *
 * Returns the configured AI provider based on environment variables.
 * Currently supports Groq. Additional providers can be added here.
 *
 * SECRET HANDLING: The API key is read from server-side environment
 * variables only. It is NEVER exposed to browser code.
 */
export function getAIProvider(): AIProvider {
  const provider = process.env.AI_PROVIDER || "groq";

  switch (provider) {
    case "groq":
      return new GroqProvider();
    default:
      throw new Error(`Unknown AI provider: ${provider}`);
  }
}

// Re-export types for convenience
export type { AIProvider, AIRequest, AIResponse };
