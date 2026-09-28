import { NextResponse } from "next/server";
import { z } from "zod";
import { createWooCommerceConnection, listConnections } from "@/lib/integrations/woocommerce/provisioning";
import { prisma } from "@/lib/db/prisma";

// ─── Request Validation ───────────────────────────────────────

const CreateConnectionSchema = z.object({
  siteUrl: z.string().url().min(1).max(500),
  siteName: z.string().max(200).optional(),
});

// ─── API Routes ───────────────────────────────────────────────

/**
 * POST /api/integrations/woocommerce/connections
 *
 * Create a new WooCommerce connection for the authenticated tenant.
 * Returns the connection ID and secret (secret shown only once).
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const parsed = CreateConnectionSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request", details: parsed.error.errors },
        { status: 400 }
      );
    }

    // Get tenant from the first available tenant
    // In production, this would come from authenticated session
    const tenant = await prisma.tenant.findFirst({
      orderBy: { createdAt: "asc" },
    });

    if (!tenant) {
      return NextResponse.json(
        { error: "No tenant found" },
        { status: 500 }
      );
    }

    const result = await createWooCommerceConnection(
      tenant.id,
      parsed.data.siteUrl,
      parsed.data.siteName
    );

    if (!result.success) {
      return NextResponse.json(
        { error: result.error },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      connectionId: result.connectionId,
      connectionSecret: result.connectionSecret,
      siteUrl: result.siteUrl,
      siteName: result.siteName,
      apiUrl: process.env.APP_URL || "https://karta-ozla.onrender.com",
    });
  } catch {
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * GET /api/integrations/woocommerce/connections
 *
 * List connections for the authenticated tenant.
 */
export async function GET() {
  try {
    const tenant = await prisma.tenant.findFirst({
      orderBy: { createdAt: "asc" },
    });

    if (!tenant) {
      return NextResponse.json(
        { error: "No tenant found" },
        { status: 500 }
      );
    }

    const connections = await listConnections(tenant.id);

    return NextResponse.json({
      success: true,
      connections,
    });
  } catch {
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
