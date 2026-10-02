/**
 * Customer Identity
 *
 * First-party identity helpers shared across Website + WooCommerce +
 * WhatsApp channels.
 *
 * PRIVACY: the customer identity is NEVER a raw IP address. Anonymous web
 * visitors get a cryptographically random visitor ID generated in the
 * browser (first-party, survives navigation). Phone numbers are
 * normalized to E.164 for the WhatsApp channel identity.
 */

/**
 * Normalize a phone number to E.164-ish form:
 * - strip spaces/dashes/parentheses
 * - keep a single leading +
 * - normalize local formats like "8801XXXXXXXXX" / "01XXXXXXXXX" by
 *   preserving the digits as provided (no country guessing)
 */
export function normalizePhone(phone: string | null | undefined): string {
  const raw = String(phone || "").trim();
  if (!raw) return "";

  const hadPlus = raw.startsWith("+");
  const digits = raw.replace(/[^\d]/g, "");

  if (!digits) return "";

  // Normalize a leading 0 (local trunk prefix) only when no country code
  // is present, so "01XXXXXXXXX" keeps its digits distinct from
  // "8801XXXXXXXXX" which already carries the country code.
  if (!hadPlus && digits.startsWith("0")) {
    return digits; // local format, normalized as-is
  }

  return hadPlus ? `+${digits}` : digits;
}

/**
 * Validate a visitor ID (karta_visitor_id): "kvid_" + 32 hex characters.
 * Cryptographically random in the browser — never a raw IP address.
 */
export function isValidVisitorId(visitorId: string | null | undefined): boolean {
  return /^kvid_[0-9a-f]{32}$/.test(String(visitorId || ""));
}
