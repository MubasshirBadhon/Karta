import type { AIProviderErrorCode } from "./provider-error";

/**
 * AI Provider Circuit Breaker
 *
 * A short provider cooldown so a burst of customer messages does not
 * create a burst of doomed provider calls. When the provider is rate
 * limited (429) or unavailable (5xx), the breaker opens for a short
 * cooldown window; during the cooldown the chat route answers with
 * deterministic commerce responses immediately instead of calling the
 * provider again.
 *
 * In-memory per server instance — sufficient for a single-instance demo
 * deployment. Distributed deployments would move this to shared storage.
 */

const COOLDOWN_MS = 30000; // 30 seconds

let openUntil = 0;
let lastCode: AIProviderErrorCode | null = null;

export function isProviderCoolingDown(): boolean {
  return Date.now() < openUntil;
}

export function cooldownRemainingMs(): number {
  return Math.max(0, openUntil - Date.now());
}

/**
 * Record a provider failure. Rate limits and unavailability open the
 * breaker; auth/config errors do not (they need a settings fix, and
 * retrying is harmless).
 */
export function recordProviderFailure(code: AIProviderErrorCode, retryAfterMs?: number) {
  if (code === "AI_PROVIDER_RATE_LIMITED" || code === "AI_PROVIDER_UNAVAILABLE") {
    const cooldown = retryAfterMs && retryAfterMs > 0 ? Math.min(retryAfterMs, 120000) : COOLDOWN_MS;
    openUntil = Date.now() + cooldown;
    lastCode = code;
  }
}

export function recordProviderSuccess() {
  openUntil = 0;
  lastCode = null;
}

export function lastProviderFailureCode(): AIProviderErrorCode | null {
  return lastCode;
}
