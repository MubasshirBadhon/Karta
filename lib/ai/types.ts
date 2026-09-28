/**
 * AI Provider Types
 *
 * Abstract interface for AI providers. The AI engine depends on this
 * interface, not on any specific provider implementation.
 */

export interface AIRequest {
  messages: AIMessage[];
  temperature?: number;
  maxTokens?: number;
  tools?: AITool[];
}

export interface AIMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  toolCalls?: AIToolCall[];
  toolCallId?: string;
}

export interface AITool {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface AIToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

export interface AIResponse {
  content: string;
  toolCalls?: AIToolCall[];
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export interface AIProvider {
  generateResponse(input: AIRequest): Promise<AIResponse>;
}
