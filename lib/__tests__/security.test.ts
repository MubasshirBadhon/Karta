import { describe, it, expect } from "vitest";
import {
  validateTenantId,
  redactSecrets,
  requireEnv,
  getEnv,
} from "@/lib/security";

describe("Security Module", () => {
  describe("validateTenantId", () => {
    it("should accept a valid tenant ID", () => {
      expect(() => validateTenantId("tenant-123")).not.toThrow();
    });

    it("should throw on null tenant ID", () => {
      expect(() => validateTenantId(null)).toThrow("Tenant ID is required");
    });

    it("should throw on undefined tenant ID", () => {
      expect(() => validateTenantId(undefined)).toThrow("Tenant ID is required");
    });

    it("should throw on empty string tenant ID", () => {
      expect(() => validateTenantId("")).toThrow("Tenant ID is required");
    });

    it("should throw on whitespace-only tenant ID", () => {
      expect(() => validateTenantId("   ")).toThrow("Tenant ID is required");
    });
  });

  describe("redactSecrets", () => {
    it("should redact API keys", () => {
      const input = { apiKey: "secret-key-123", name: "test" };
      const result = redactSecrets(input);
      expect(result.apiKey).toBe("[REDACTED]");
      expect(result.name).toBe("test");
    });

    it("should redact tokens", () => {
      const input = { accessToken: "token-xyz", data: "visible" };
      const result = redactSecrets(input);
      expect(result.accessToken).toBe("[REDACTED]");
      expect(result.data).toBe("visible");
    });

    it("should redact secrets", () => {
      const input = { clientSecret: "my-secret", id: "123" };
      const result = redactSecrets(input);
      expect(result.clientSecret).toBe("[REDACTED]");
      expect(result.id).toBe("123");
    });

    it("should not modify non-sensitive fields", () => {
      const input = { name: "product", price: 100, stock: 5 };
      const result = redactSecrets(input);
      expect(result).toEqual(input);
    });
  });

  describe("requireEnv", () => {
    it("should return the value when env var is set", () => {
      process.env.TEST_VAR = "test-value";
      expect(requireEnv("TEST_VAR")).toBe("test-value");
      delete process.env.TEST_VAR;
    });

    it("should throw when env var is not set", () => {
      delete process.env.NONEXISTENT_VAR;
      expect(() => requireEnv("NONEXISTENT_VAR")).toThrow(
        "Required environment variable NONEXISTENT_VAR is not set"
      );
    });
  });

  describe("getEnv", () => {
    it("should return the value when env var is set", () => {
      process.env.TEST_VAR = "test-value";
      expect(getEnv("TEST_VAR")).toBe("test-value");
      delete process.env.TEST_VAR;
    });

    it("should return default value when env var is not set", () => {
      delete process.env.NONEXISTENT_VAR;
      expect(getEnv("NONEXISTENT_VAR", "default")).toBe("default");
    });

    it("should return undefined when env var is not set and no default", () => {
      delete process.env.NONEXISTENT_VAR;
      expect(getEnv("NONEXISTENT_VAR")).toBeUndefined();
    });
  });
});
