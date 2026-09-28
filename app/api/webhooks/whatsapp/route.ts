import { NextResponse } from "next/server";
import { verifyWebhookSignature, validateVerificationRequest, isValidWebhookPayload } from "@/lib/channels/whatsapp/webhook";
import { processWebhookPayload } from "@/lib/channels/whatsapp/adapter";
import { getWhatsAppProvider } from "@/lib/channels/whatsapp/provider";
import { processMessage } from "@/lib/ai/commerce-engine";
import { getConversationHistory, saveMessage } from "@/lib/ai/conversation-service";

// ─── GET: Webhook Verification ────────────────────────────────

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const mode = searchParams.get("hub.mode");
  const token = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");

  const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN;
  if (!verifyToken) {
    return NextResponse.json(
      { error: "WhatsApp verify token not configured" },
      { status: 500 }
    );
  }

  const result = validateVerificationRequest(mode || "", token || "", challenge || "", verifyToken);

  if (result) {
    return new Response(result, { status: 200 });
  }

  return NextResponse.json(
    { error: "Verification failed" },
    { status: 403 }
  );
}

// ─── POST: Receive Webhook Events ─────────────────────────────

export async function POST(request: Request) {
  try {
    // Verify webhook signature
    const signature = request.headers.get("x-hub-signature-256");
    const appSecret = process.env.WHATSAPP_APP_SECRET;

    if (!signature || !appSecret) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.text();

    if (!verifyWebhookSignature(body, signature, appSecret)) {
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }

    // Parse payload
    const payload = JSON.parse(body);

    if (!isValidWebhookPayload(payload)) {
      return NextResponse.json({ status: "ok" });
    }

    // Process messages
    const unifiedMessages = await processWebhookPayload(payload);

    // Process each message through AI engine
    for (const message of unifiedMessages) {
      try {
        // Save inbound message
        await saveMessage(message.conversationId!, "customer", message.text);

        // Get conversation history
        const history = await getConversationHistory(message.conversationId!);

        // Process through AI engine
        const result = await processMessage(message, history);

        // Save outbound message
        if (result.text) {
          await saveMessage(message.conversationId!, "assistant", result.text);
        }

        // Send response via WhatsApp
        const provider = getWhatsAppProvider();
        await provider.sendTextMessage({
          phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID!,
          recipientPhone: message.customerId?.replace("wa_", "") || "",
          text: result.text,
        });
      } catch (error) {
        // Log sanitized error, don't expose internals
        console.error("Error processing WhatsApp message:", {
          conversationId: message.conversationId,
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }

    return NextResponse.json({ status: "ok" });
  } catch {
    return NextResponse.json({ status: "ok" });
  }
}
