import { describe, it, expect, vi, beforeEach } from "vitest";
import { GroqProvider } from "@/lib/ai/groq";
import type { AIRequest, AIResponse } from "@/lib/ai/types";

describe("AI Provider", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  describe("GroqProvider", () => {
    it("should throw when GROQ_API_KEY is not set", () => {
      delete process.env.GROQ_API_KEY;
      expect(() => new GroqProvider()).toThrow("GROQ_API_KEY is not set");
    });

    it("should initialize when GROQ_API_KEY is set", () => {
      process.env.GROQ_API_KEY = "test-key";
      const provider = new GroqProvider();
      expect(provider).toBeInstanceOf(GroqProvider);
    });

    it("should implement the AIProvider interface", () => {
      process.env.GROQ_API_KEY = "test-key";
      const provider = new GroqProvider();

      // Check that generateResponse method exists
      expect(typeof provider.generateResponse).toBe("function");
    });

    it("should throw on API error", async () => {
      process.env.GROQ_API_KEY = "test-key";
      const provider = new GroqProvider();

      // Mock fetch to return an error
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: false,
          status: 401,
          text: () => Promise.resolve("Unauthorized"),
        })
      );

      const request: AIRequest = {
        messages: [{ role: "user", content: "Hello" }],
      };

      await expect(provider.generateResponse(request)).rejects.toThrow(
        "Groq API error"
      );

      vi.unstubAllGlobals();
    });

    it("should return a valid AIResponse on success", async () => {
      process.env.GROQ_API_KEY = "test-key";
      const provider = new GroqProvider();

      const mockResponse = {
        choices: [
          {
            message: {
              role: "assistant",
              content: "Hello! How can I help you?",
            },
          },
        ],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 20,
          total_tokens: 30,
        },
      };

      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: true,
          json: () => Promise.resolve(mockResponse),
        })
      );

      const request: AIRequest = {
        messages: [{ role: "user", content: "Hello" }],
      };

      const response: AIResponse = await provider.generateResponse(request);

      expect(response.content).toBe("Hello! How can I help you?");
      expect(response.usage).toEqual({
        promptTokens: 10,
        completionTokens: 20,
        totalTokens: 30,
      });

      vi.unstubAllGlobals();
    });

    it("should include tools in request when provided", async () => {
      process.env.GROQ_API_KEY = "test-key";
      const provider = new GroqProvider();

      let capturedBody: Record<string, unknown> | null = null;

      vi.stubGlobal(
        "fetch",
        vi.fn().mockImplementation((url: string, options: RequestInit) => {
          capturedBody = JSON.parse(options.body as string);
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                choices: [{ message: { role: "assistant", content: "OK" } }],
              }),
          });
        })
      );

      const request: AIRequest = {
        messages: [{ role: "user", content: "Find products" }],
        tools: [
          {
            type: "function",
            function: {
              name: "searchProducts",
              description: "Search for products",
              parameters: { type: "object", properties: {} },
            },
          },
        ],
      };

      await provider.generateResponse(request);

      expect(capturedBody).not.toBeNull();
      expect(capturedBody!.tools).toBeDefined();
      expect((capturedBody!.tools as unknown[]).length).toBe(1);

      vi.unstubAllGlobals();
    });
  });

  describe("AI Types", () => {
    it("should have correct AIRequest structure", () => {
      const request: AIRequest = {
        messages: [
          { role: "system", content: "You are a sales assistant" },
          { role: "user", content: "Find me a product" },
        ],
        temperature: 0.7,
        maxTokens: 1024,
      };

      expect(request.messages).toHaveLength(2);
      expect(request.temperature).toBe(0.7);
      expect(request.maxTokens).toBe(1024);
    });

    it("should have correct AIResponse structure", () => {
      const response: AIResponse = {
        content: "Here are the products",
        usage: {
          promptTokens: 50,
          completionTokens: 100,
          totalTokens: 150,
        },
      };

      expect(response.content).toBe("Here are the products");
      expect(response.usage?.totalTokens).toBe(150);
    });
  });
});
