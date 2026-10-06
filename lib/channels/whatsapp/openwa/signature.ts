import { createHmac, timingSafeEqual } from "crypto";

/**
 * OpenWA Webhook Signature Verification
 *
 * Verifies the X-OpenWA-Signature header: HMAC-SHA256 over the RAW request
 * body, keyed by OPENWA_WEBHOOK_SECRET, with a timing-safe comparison.
 * Both "sha256=<hex>" and bare "<hex>" forms are accepted.
 */
export function verifyOpenWASignature(
  rawBody: string,
  signature: string,
  secret: string
): boolean {
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");

  const provided = signature.startsWith("sha256=") ? signature.slice(7) : signature;

  const providedBuffer = Buffer.from(provided);
  const expectedBuffer = Buffer.from(expected);

  if (providedBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return timingSafeEqual(providedBuffer, expectedBuffer);
}
