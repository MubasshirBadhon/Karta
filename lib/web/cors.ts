import { prisma } from "@/lib/db/prisma";

/**
 * CORS for the Website Chat Endpoint
 *
 * The merchant website (e.g. https://bd-deals.unaux.com) is hosted on a
 * different origin from Karta Cloud. The browser sends a preflight OPTIONS
 * request before any cross-origin POST with a JSON content type — without
 * Access-Control-Allow-Origin on that preflight response the browser blocks
 * the request entirely (this was the cause of the widget showing
 * "couldn't reach the server").
 *
 * Rules:
 * - The allowed origin is associated with the connected WooCommerce store
 *   (its siteUrl), never "*".
 * - Preflight is answered with 204 + CORS headers only for allowed origins.
 * - No credentials are used by the widget, so
 *   Access-Control-Allow-Credentials is intentionally NOT sent.
 */

function normalizeOrigin(origin: string): string {
  return origin.trim().replace(/\/+$/, "").toLowerCase();
}

/**
 * Compare a browser Origin against a store siteUrl by hostname.
 * www variants and trailing slashes are normalized away.
 */
export function isAllowedWebsiteOrigin(origin: string, siteUrls: (string | null | undefined)[]): boolean {
  if (!origin) return false;

  let originHost = "";
  try {
    originHost = new URL(origin).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return false;
  }
  if (!originHost) return false;

  return siteUrls.some((siteUrl) => {
    if (!siteUrl) return false;
    try {
      const siteHost = new URL(siteUrl).hostname.toLowerCase().replace(/^www\./, "");
      return siteHost === originHost;
    } catch {
      return false;
    }
  });
}

/**
 * Build CORS response headers for an allowed origin.
 * The origin is echoed exactly (never "*").
 */
export function buildCorsHeaders(origin: string): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": normalizeOrigin(origin),
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

/**
 * Get the site URLs of all active WooCommerce connections.
 * Used to answer preflight requests, which do not carry the site token.
 */
export async function fetchAllowedSiteUrls(): Promise<string[]> {
  const connections = await prisma.wooCommerceConnection.findMany({
    where: { status: "active" },
    select: { siteUrl: true },
  });
  return connections.map((c) => c.siteUrl).filter((url): url is string => Boolean(url));
}
