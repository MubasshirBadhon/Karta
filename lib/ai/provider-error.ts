/**
 * AI Provider Error Classification
 *
 * Classifies provider failures WITHOUT exposing secrets or provider
 * details to customers. Used by the commerce engine and the chat route
 * to choose deterministic fallbacks instead of misleading network errors.
 */

export type AIProviderErrorCode =
  | "AI_PROVIDER_RATE_LIMITED" // 429
  | "AI_PROVIDER_AUTH" // 401 / 403
  | "AI_PROVIDER_BAD_REQUEST" // 400
  | "AI_PROVIDER_NOT_FOUND" // 404 (e.g. unsupported/deprecated model)
  | "AI_PROVIDER_UNAVAILABLE" // 500 / 502 / 503
  | "AI_PROVIDER_TIMEOUT" // abort / timeout
  | "AI_PROVIDER_NETWORK" // fetch failure (DNS, connection refused)
  | "AI_PROVIDER_NO_KEY" // API key not configured
  | "AI_PROVIDER_EMPTY" // empty response
  | "AI_PROVIDER_UNKNOWN";

export interface AIProviderError extends Error {
  code: AIProviderErrorCode;
  status?: number;
  /** Milliseconds to wait before retrying (from Retry-After when present). */
  retryAfterMs?: number;
}

/**
 * Short customer-safe status derived from a provider error code.
 * Never contains provider names, keys, or internal details.
 */
export function providerStatusFromCode(code: AIProviderErrorCode): string {
  switch (code) {
    case "AI_PROVIDER_RATE_LIMITED":
      return "rate_limited";
    case "AI_PROVIDER_AUTH":
    case "AI_PROVIDER_NO_KEY":
      return "auth_error";
    case "AI_PROVIDER_BAD_REQUEST":
    case "AI_PROVIDER_NOT_FOUND":
      return "provider_config_error";
    case "AI_PROVIDER_UNAVAILABLE":
      return "unavailable";
    case "AI_PROVIDER_TIMEOUT":
      return "timeout";
    case "AI_PROVIDER_NETWORK":
      return "network_error";
    case "AI_PROVIDER_EMPTY":
      return "empty_response";
    default:
      return "error";
  }
}

/**
 * Parse a Retry-After header (seconds or HTTP date) into milliseconds.
 */
function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (!Number.isNaN(seconds) && seconds >= 0) {
    return Math.min(seconds * 1000, 300000); // cap at 5 minutes
  }
  const date = Date.parse(value);
  if (!Number.isNaN(date)) {
    return Math.min(Math.max(date - Date.now(), 0), 300000);
  }
  return undefined;
}

/**
 * Classify a failure thrown by the provider layer.
 * `rateLimitHeaders` carries the sanitized rate-limit headers
 * (retry-after, x-ratelimit-*) read from the provider response —
 * logged server-side only, never exposed to the browser.
 */
export function classifyProviderFailure(
  error: unknown,
  context?: {
    status?: number;
    retryAfter?: string | null;
  }
): AIProviderError {
  const base = error instanceof Error ? error.message : "Unknown provider error";
  const providerError = error as AIProviderError;

  if (providerError && providerError.code) {
    return providerError; // already classified
  }

  // HTTP status from the context (provider response) or the error message
  const status = context?.status ?? (() => {
    const m = base.match(/\((\d{3})\)/);
    return m ? Number(m[1]) : undefined;
  })();

  if (status === 429) {
    return makeError("AI_PROVIDER_RATE_LIMITED", base, status, parseRetryAfter(context?.retryAfter ?? null));
  }
  if (status === 401 || status === 403) {
    return makeError("AI_PROVIDER_AUTH", base, status);
  }
  if (status === 404) {
    return makeError("AI_PROVIDER_NOT_FOUND", base, status);
  }
  if (status === 400) {
    return makeError("AI_PROVIDER_BAD_REQUEST", base, status);
  }
  if (status !== undefined && status >= 500) {
    return makeError("AI_PROVIDER_UNAVAILABLE", base, status);
  }

  // Fetch failures: TypeError (network) vs AbortError (timeout)
  const name = error instanceof Error ? error.name : "";
  if (name === "AbortError" || /timeout|timed out/i.test(base)) {
    return makeError("AI_PROVIDER_TIMEOUT", base);
  }
  if (name === "TypeError" || /fetch|network|ECONNREFUSED|ENOTFOUND|socket/i.test(base)) {
    return makeError("AI_PROVIDER_NETWORK", base);
  }

  return makeError("AI_PROVIDER_UNKNOWN", base);
}

function makeError(
  code: AIProviderErrorCode,
  message: string,
  status?: number,
  retryAfterMs?: number
): AIProviderError {
  const error = new Error(message) as AIProviderError;
  error.code = code;
  if (status !== undefined) error.status = status;
  if (retryAfterMs !== undefined) error.retryAfterMs = retryAfterMs;
  return error;
}
