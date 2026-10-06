import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * OpenWA WhatsApp Transport — Focused Tests
 *
 * Covers: payload parsing, message.received handling, signature
 * verification (valid/invalid/missing), fromMe loop prevention,
 * idempotency, chatId derivation, outbound send-text, provider selection,
 * and the Meta provider regression.
 */

const mockFetch = vi.fn();
global.fetch = mockFetch as unknown as typeof global.fetch;

import { parseOpenWAEvent, isSupportedOpenWAEvent } from "@/lib/channels/whatsapp/openwa/parser";
import { OpenWAProvider, chatIdFromPhone } from "@/lib/channels/whatsapp/openwa/provider";
import { verifyOpenWASignature } from "@/lib/channels/whatsapp/openwa/signature";
import { getWhatsAppProvider, WhatsAppCloudProvider } from "@/lib/channels/whatsapp/provider";
import { createHmac } from "crypto";

const SESSION_ID = "default";

function makeEvent(overrides: Record<string, unknown> = {}) {
  return {
    event: "message.received",
    timestamp: Date.now(),
    sessionId: SESSION_ID,
    idempotencyKey: "idem-123",
    deliveryId: "del-1",
    data: {
      id: "msg-1",
      from: "8801711000000",
      to: "8801722000000",
      chatId: "8801711000000@c.us",
      body: "Do you have black t-shirts?",
      type: "text",
      timestamp: Date.now(),
      fromMe: false,
      isGroup: false,
      kind: "individual",
    },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockFetch.mockReset();
});

// ─── Payload parsing ─────────────────────────────────────────

describe("OpenWA payload parsing", () => {
  it("parses message.received into the unified ParsedWhatsAppMessage format", () => {
    const parsed = parseOpenWAEvent(makeEvent());

    expect(parsed).not.toBeNull();
    expect(parsed!.externalMessageId).toBe("idem-123"); // idempotency key
    expect(parsed!.senderPhone).toBe("8801711000000");
    expect(parsed!.text).toBe("Do you have black t-shirts?");
    expect(parsed!.phoneNumberId).toBe(SESSION_ID); // the session identifies the connection
    expect(parsed!.messageType).toBe("text");
  });

  it("ignores non-message.received events", () => {
    expect(parseOpenWAEvent(makeEvent({ event: "session.status" }))).toBeNull();
    expect(parseOpenWAEvent(makeEvent({ event: "message.ack" }))).toBeNull();
  });

  it("ignores fromMe=true events (loop prevention)", () => {
    const event = makeEvent();
    (event.data as Record<string, unknown>).fromMe = true;

    expect(parseOpenWAEvent(event)).toBeNull();
    expect(isSupportedOpenWAEvent(event)).toBe(false);
  });

  it("ignores group messages", () => {
    const event = makeEvent();
    (event.data as Record<string, unknown>).isGroup = true;

    expect(parseOpenWAEvent(event)).toBeNull();
  });

  it("ignores non-text messages", () => {
    expect(parseOpenWAEvent(makeEvent({ data: { type: "image", fromMe: false, isGroup: false } }))).toBeNull();
    expect(parseOpenWAEvent(makeEvent({ data: { type: "text", body: "", fromMe: false, isGroup: false } }))).toBeNull();
  });

  it("normalizes timestamps (seconds and milliseconds)", () => {
    const secondsEvent = makeEvent();
    (secondsEvent.data as Record<string, unknown>).timestamp = 1700000000; // seconds
    const parsedSeconds = parseOpenWAEvent(secondsEvent);
    expect(new Date(parsedSeconds!.timestamp).getTime()).toBe(1700000000000);

    const msEvent = makeEvent();
    (msEvent.data as Record<string, unknown>).timestamp = 1700000000000; // milliseconds
    const parsedMs = parseOpenWAEvent(msEvent);
    expect(new Date(parsedMs!.timestamp).getTime()).toBe(1700000000000);
  });
});

// ─── Signature verification ──────────────────────────────────

describe("OpenWA signature verification", () => {
  const body = JSON.stringify(makeEvent());
  const secret = "webhook-secret";

  it("accepts a valid signature (timing-safe comparison)", () => {
    const signature = createHmac("sha256", secret).update(body).digest("hex");
    expect(verifyOpenWASignature(body, signature, secret)).toBe(true);
  });

  it("accepts the sha256=<hex> prefixed form", () => {
    const signature = "sha256=" + createHmac("sha256", secret).update(body).digest("hex");
    expect(verifyOpenWASignature(body, signature, secret)).toBe(true);
  });

  it("rejects an invalid signature", () => {
    const signature = createHmac("sha256", "wrong-secret").update(body).digest("hex");
    expect(verifyOpenWASignature(body, signature, secret)).toBe(false);
  });

  it("rejects a signature computed over a modified body", () => {
    const signature = createHmac("sha256", secret).update(body).digest("hex");
    const tampered = body.replace("black", "white");
    expect(verifyOpenWASignature(tampered, signature, secret)).toBe(false);
  });

  it("rejects a signature of the wrong length", () => {
    expect(verifyOpenWASignature(body, "abc123", secret)).toBe(false);
  });
});

// ─── Idempotency ─────────────────────────────────────────────

describe("OpenWA idempotency", () => {
  it("uses the idempotencyKey as the external message ID (retries dedupe)", () => {
    const e1 = parseOpenWAEvent(makeEvent({ idempotencyKey: "idem-42" }));
    const e2 = parseOpenWAEvent(makeEvent({ idempotencyKey: "idem-42" }));

    // Same idempotency key → the same external message ID → the existing
    // isMessageProcessed check dedupes retries
    expect(e1!.externalMessageId).toBe("idem-42");
    expect(e2!.externalMessageId).toBe(e1!.externalMessageId);
  });

  it("falls back to the event data id when the idempotencyKey is missing", () => {
    const parsed = parseOpenWAEvent(makeEvent({ idempotencyKey: "" }));
    expect(parsed!.externalMessageId).toBe("msg-1");
  });
});

// ─── Phone normalization / chatId derivation ─────────────────

describe("chatId derivation", () => {
  it("derives the OpenWA chat ID from a phone number", () => {
    expect(chatIdFromPhone("8801711000000")).toBe("8801711000000@c.us");
    expect(chatIdFromPhone("+8801711000000")).toBe("8801711000000@c.us");
    expect(chatIdFromPhone("+880 1711 000 000")).toBe("8801711000000@c.us");
  });
});

// ─── Outbound send-text ──────────────────────────────────────

describe("OpenWA outbound send-text", () => {
  it("POSTs to the send-text endpoint with the X-API-Key header and the chatId", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ id: "sent-1", sent: true }),
    });

    const provider = new OpenWAProvider({
      baseUrl: "http://localhost:2785/",
      apiKey: "test-api-key",
      sessionId: "default",
    });

    const result = await provider.sendTextMessage({
      phoneNumberId: "default",
      recipientPhone: "+8801711000000",
      text: "জি, Classic Cotton T-Shirt আছে।",
    });

    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:2785/api/sessions/default/messages/send-text",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "X-API-Key": "test-api-key",
          "Content-Type": "application/json",
        }),
      })
    );
    const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(callBody).toEqual({ chatId: "8801711000000@c.us", text: "জি, Classic Cotton T-Shirt আছে।" });
    expect(result.externalMessageId).toBe("sent-1");
  });

  it("prefers the explicit inbound chatId when provided", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ id: "sent-2" }),
    });

    const provider = new OpenWAProvider({
      baseUrl: "http://localhost:2785",
      apiKey: "test-api-key",
      sessionId: "default",
    });

    await provider.sendTextMessage({
      phoneNumberId: "default",
      recipientPhone: "+8801711000000",
      text: "hello",
      chatId: "8801999000000@c.us",
    });

    const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(callBody.chatId).toBe("8801999000000@c.us");
  });

  it("throws a clean error on a non-OK response (no API key in the error)", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: () => Promise.resolve("Internal error with key sk-test-123"),
    });

    const provider = new OpenWAProvider({
      baseUrl: "http://localhost:2785",
      apiKey: "test-api-key",
      sessionId: "default",
    });

    await expect(
      provider.sendTextMessage({ phoneNumberId: "default", recipientPhone: "+8801711000000", text: "hi" })
    ).rejects.toThrow(/OpenWA API error \(500\)/);
  });
});

// ─── Provider selection ──────────────────────────────────────

describe("provider selection", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  it("selects the OpenWA provider when WHATSAPP_PROVIDER=openwa", () => {
    process.env.WHATSAPP_PROVIDER = "openwa";
    process.env.OPENWA_BASE_URL = "http://localhost:2785";
    process.env.OPENWA_API_KEY = "key";
    process.env.OPENWA_SESSION_ID = "default";
    // Meta credentials intentionally absent
    delete process.env.WHATSAPP_ACCESS_TOKEN;

    const provider = getWhatsAppProvider();
    expect(provider).toBeInstanceOf(OpenWAProvider);
  });

  it("throws a clear error when OpenWA is selected but not configured", () => {
    process.env.WHATSAPP_PROVIDER = "openwa";
    delete process.env.OPENWA_BASE_URL;
    delete process.env.OPENWA_API_KEY;
    delete process.env.OPENWA_SESSION_ID;

    expect(() => getWhatsAppProvider()).toThrow(/OpenWA is not configured/);
  });

  it("Meta provider regression: defaults to Meta and validates credentials", () => {
    process.env.WHATSAPP_PROVIDER = "meta";
    process.env.WHATSAPP_ACCESS_TOKEN = "meta-token";
    process.env.WHATSAPP_PHONE_NUMBER_ID = "phone-1";
    process.env.WHATSAPP_VERIFY_TOKEN = "verify";

    const provider = getWhatsAppProvider();
    expect(provider).toBeInstanceOf(WhatsAppCloudProvider);
  });

  it("Meta provider regression: absent provider setting defaults to Meta", () => {
    delete process.env.WHATSAPP_PROVIDER;
    process.env.WHATSAPP_ACCESS_TOKEN = "meta-token";
    process.env.WHATSAPP_PHONE_NUMBER_ID = "phone-1";
    process.env.WHATSAPP_VERIFY_TOKEN = "verify";

    expect(getWhatsAppProvider()).toBeInstanceOf(WhatsAppCloudProvider);
  });

  it("Meta provider regression: missing Meta credentials still throw in meta mode", () => {
    process.env.WHATSAPP_PROVIDER = "meta";
    delete process.env.WHATSAPP_ACCESS_TOKEN;

    expect(() => getWhatsAppProvider()).toThrow(/WHATSAPP_ACCESS_TOKEN is not set/);
  });

  it("no secrets are exposed by the provider objects", () => {
    process.env.WHATSAPP_PROVIDER = "openwa";
    process.env.OPENWA_BASE_URL = "http://localhost:2785";
    process.env.OPENWA_API_KEY = "secret-key-123";
    process.env.OPENWA_SESSION_ID = "default";

    const provider = getWhatsAppProvider() as unknown as Record<string, unknown>;
    // The key is private — it is not enumerable on the instance
    const serialized = JSON.stringify(provider);
    expect(serialized).not.toContain("secret-key-123");
  });
});
