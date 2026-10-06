import { NextResponse } from "next/server";
import { parseOpenWAEvent } from "@/lib/channels/whatsapp/openwa/parser";
import { verifyOpenWASignature } from "@/lib/channels/whatsapp/openwa/signature";
import {
  isMessageProcessed,
  toUnifiedMessage,
} from "@/lib/channels/whatsapp/adapter";
import { getWhatsAppProvider } from "@/lib/channels/whatsapp/provider";
import { processMessage } from "@/lib/ai/commerce-engine";
import { getConversationHistory, saveMessage } from "@/lib/ai/conversation-service";
import { trackEvent } from "@/lib/intelligence/events";

/**
 * POST /api/webhooks/openwa
 *
 * Dedicated webhook endpoint for the OpenWA WhatsApp transport
 * (ADDITIVE — the existing Meta webhook at /api/webhooks/whatsapp is
 * completely untouched).
 *
 * Security:
 * - The X-OpenWA-Signature header (HMAC-SHA256 over the RAW request body,
 *   keyed by OPENWA_WEBHOOK_SECRET) is verified with a timing-safe
 *   comparison. Invalid/missing signatures are rejected with 401.
 * - The API key and webhook secret are never logged or exposed.
 *
 * Pipeline (the EXISTING shared architecture — OpenWA is only a
 * transport adapter):
 *   parse (fromMe/groups ignored, idempotencyKey as the message ID)
 *     → idempotency check (retries never duplicate messages/replies)
 *     → tenant + customer (tenant + normalized phone) + conversation
 *     → shared AI commerce engine
 *     → outbound send-text via the OpenWA provider
 */
export async function POST(request: Request) {
  try {
    // ─── Signature verification (timing-safe, raw body) ────────
    const signature = request.headers.get("x-openwa-signature");
    const secret = process.env.OPENWA_WEBHOOK_SECRET;

    const rawBody = await request.text();

    if (!signature || !secret) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!verifyOpenWASignature(rawBody, signature, secret)) {
      console.error("[OPENWA] Webhook rejected: invalid signature");
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }

    // ─── Parse the event ──────────────────────────────────────
    let payload;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
    }

    const parsed = parseOpenWAEvent(payload);

    if (!parsed) {
      // Unsupported event type / fromMe / group / non-text — accepted,
      // nothing processed
      return NextResponse.json({ status: "ok", processed: false });
    }

    // ─── Idempotency: OpenWA retries must not duplicate anything ─
    if (await isMessageProcessed(parsed.externalMessageId)) {
      return NextResponse.json({ status: "ok", duplicate: true });
    }

    // ─── Tenant + customer (tenant + normalized phone) + conversation ─
    const unified = await toUnifiedMessage(parsed);

    if (!unified) {
      // No active WhatsApp connection matches this session
      console.error("[OPENWA] Dropped message: no active connection for session", {
        sessionId: parsed.phoneNumberId,
      });
      return NextResponse.json({ status: "ok", processed: false });
    }

    const tenantId = unified.tenantId;

    // Save the inbound message
    await saveMessage(unified.conversationId!, "user", unified.text);

    // Get the conversation history
    const history = await getConversationHistory(unified.conversationId!);

    // ─── Shared AI commerce engine (no second AI implementation) ─
    const result = await processMessage(unified, history, {
      extraSystem: WHATSAPP_SUPPLEMENT,
    });

    // Track mentioned products (markers are internal — stripped before sending)
    const cleanText = stripMarkers(result.text);

    if (cleanText) {
      await saveMessage(unified.conversationId!, "assistant", cleanText);
    }

    // Customer intelligence events
    await trackEvent(tenantId, {
      type: "MESSAGE_SENT",
      customerId: unified.customerId,
      metadata: { channel: "whatsapp", transport: "openwa" },
    });

    // ─── Outbound via the OpenWA provider ─────────────────────
    if (cleanText) {
      try {
        const provider = getWhatsAppProvider();
        const chatId = getInboundChatId(payload);
        await provider.sendTextMessage({
          phoneNumberId: unified.tenantId, // unused by OpenWA
          recipientPhone: unified.customerId ?? "",
          text: cleanText,
          ...(chatId ? { chatId } : {}),
        });
      } catch (error) {
        // Structured failure log — never the API key, the secret, or the
        // message content
        console.error("[OPENWA] Outbound failed:", {
          operation: "send-text",
          conversationId: unified.conversationId!,
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }

    return NextResponse.json({ status: "ok", processed: true });
  } catch (error) {
    console.error("[OPENWA] Webhook error:", {
      error: error instanceof Error ? error.message : "Unknown error",
    });
    return NextResponse.json({ status: "ok" });
  }
}

/**
 * Extract the inbound event's chatId so replies go to the exact chat.
 */
function getInboundChatId(payload: unknown): string | null {
  const data = (payload as { data?: { chatId?: string } })?.data;
  return data?.chatId ?? null;
}

function stripMarkers(text: string): string {
  return String(text || "")
    .replace(/\[PRODUCT:[^\]]+\]/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * WhatsApp-channel AI supplement (shared with the Meta flow's behavior —
 * markers are stripped before sending).
 */
const WHATSAPP_SUPPLEMENT = `## WhatsApp channel rules
- For EVERY product you mention, add a marker line [PRODUCT:<id>] on its own line (the marker is removed before the message is sent).
- NEVER invent products, prices, stock, discounts, or URLs. Only use data returned by commerce tools.
- Match the customer's language (Bangla, Banglish, or English).
- Keep responses short.`;
