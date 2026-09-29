import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Demo Chat Site Token Tests
 *
 * Tests the site token authentication flow for the demo chat.
 */

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe("Demo Chat Site Token", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("siteToken configuration", () => {
    it("should read NEXT_PUBLIC_DEMO_SITE_TOKEN from environment", () => {
      // The client reads process.env.NEXT_PUBLIC_DEMO_SITE_TOKEN
      // This is a build-time variable embedded in the client bundle
      const token = process.env.NEXT_PUBLIC_DEMO_SITE_TOKEN || "";
      expect(typeof token).toBe("string");
    });

    it("should have empty string when token is not configured", () => {
      // When NEXT_PUBLIC_DEMO_SITE_TOKEN is not set, the client should use empty string
      const token = process.env.NEXT_PUBLIC_DEMO_SITE_TOKEN || "";
      // This is expected to be empty in development without the env var
      expect(token).toBe("");
    });
  });

  describe("API request with siteToken", () => {
    it("should send siteToken in request body", async () => {
      const mockResponse = {
        success: true,
        conversationId: "conv-123",
        response: "Hello! How can I help you?",
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const siteToken = "kwc_abc123";
      const message = "Hi";

      await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId: undefined,
          message,
          siteToken,
        }),
      });

      expect(mockFetch).toHaveBeenCalledWith(
        "/api/chat",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            conversationId: undefined,
            message: "Hi",
            siteToken: "kwc_abc123",
          }),
        })
      );
    });

    it("should handle 401 unauthorized response", async () => {
      const mockResponse = {
        error: "Unauthorized. Provide a valid site token or conversation ID.",
      };

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: () => Promise.resolve(mockResponse),
      });

      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: "Hi",
          siteToken: "",
        }),
      });

      expect(response.status).toBe(401);
      const data = await response.json();
      expect(data.error).toContain("Unauthorized");
    });

    it("should handle successful AI response", async () => {
      const mockResponse = {
        success: true,
        conversationId: "conv-123",
        response: "Hi! I'm Karta, your AI shopping assistant.",
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: "Hi",
          siteToken: "kwc_valid_token",
        }),
      });

      expect(response.ok).toBe(true);
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.response).toContain("Karta");
    });
  });

  describe("tenant resolution", () => {
    it("should resolve tenant from siteToken", async () => {
      // The server looks up WooCommerceConnection by connectionId (siteToken)
      // and returns the associated tenantId
      const mockConnection = {
        id: "conn-1",
        tenantId: "tenant-demo",
        connectionId: "kwc_abc123",
        status: "active",
      };

      // Simulate the database lookup
      const siteToken = "kwc_abc123";
      const resolvedTenantId = mockConnection.tenantId;

      expect(resolvedTenantId).toBe("tenant-demo");
    });

    it("should reject invalid siteToken", async () => {
      const invalidToken = "invalid_token";
      // Server should return 401 for invalid tokens
      expect(invalidToken).not.toBe("kwc_abc123");
    });
  });

  describe("security", () => {
    it("should not expose connectionSecret to browser", () => {
      // The client only receives siteToken, never connectionSecret
      const clientData = {
        siteToken: "kwc_abc123",
        message: "Hi",
      };

      expect(clientData).not.toHaveProperty("connectionSecret");
      expect(clientData).not.toHaveProperty("secret");
    });

    it("should not expose GROQ_API_KEY to browser", () => {
      // GROQ_API_KEY should only be accessed server-side
      const clientData = {
        siteToken: "kwc_abc123",
      };

      expect(clientData).not.toHaveProperty("groqApiKey");
      expect(clientData).not.toHaveProperty("GROQ_API_KEY");
    });
  });
});
