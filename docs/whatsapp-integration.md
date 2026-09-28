# WhatsApp Integration

## Architecture

```
WhatsApp Customer
    ↓
Meta Cloud API
    ↓
POST /api/webhooks/whatsapp
    ↓
verifyWebhookSignature (HMAC-SHA256)
    ↓
parseWhatsAppPayload → ParsedWhatsAppMessage
    ↓
resolveTenantByPhoneNumber (phone_number_id → tenantId)
    ↓
getOrCreateCustomer (tenantId + phone)
    ↓
getOrCreateWhatsAppConversation
    ↓
isMessageProcessed (idempotency check)
    ↓
UnifiedMessage { channel: "whatsapp" }
    ↓
processMessage() ← SAME AI ENGINE AS WEB
    ↓
Commerce Tools (search_products, get_product, get_variant, check_stock)
    ↓
Real WooCommerce Product Data
    ↓
WhatsAppCloudProvider.sendTextMessage()
    ↓
Customer receives real WhatsApp reply
```

## Webhook Endpoints

### GET /api/webhooks/whatsapp

Webhook verification endpoint. Meta sends a GET request to verify the webhook URL.

**Parameters:**
- `hub.mode` — Must be `"subscribe"`
- `hub.verify_token` — Must match `WHATSAPP_VERIFY_TOKEN`
- `hub.challenge` — Challenge string to return on success

**Response:**
- `200 OK` with challenge body on success
- `403 Forbidden` on verification failure

### POST /api/webhooks/whatsapp

Receives incoming WhatsApp messages.

**Headers:**
- `X-Hub-Signature-256` — HMAC-SHA256 signature for verification

**Flow:**
1. Verify signature using `WHATSAPP_APP_SECRET`
2. Parse payload and extract text messages
3. Resolve tenant from `phone_number_id`
4. Get or create customer and conversation
5. Check idempotency (external message ID)
6. Process through AI commerce engine
7. Send response via WhatsApp API

## Environment Variables

| Variable | Purpose | Required |
|----------|---------|----------|
| `WHATSAPP_ACCESS_TOKEN` | Meta Graph API access token | Yes |
| `WHATSAPP_VERIFY_TOKEN` | Custom token for webhook verification | Yes |
| `WHATSAPP_PHONE_NUMBER_ID` | WhatsApp Business phone number ID | Yes |
| `WHATSAPP_BUSINESS_ACCOUNT_ID` | Meta Business account ID | No |
| `WHATSAPP_API_VERSION` | Graph API version (default: v18.0) | No |
| `WHATSAPP_APP_SECRET` | App secret for signature verification | Yes |

## Tenant Mapping

Each WhatsApp phone number ID is mapped to a Karta tenant via the `WhatsAppConnection` model:

```
phone_number_id → WhatsAppConnection → tenantId
```

This ensures:
- No arbitrary tenant injection
- Proper data isolation
- Correct product catalog per merchant

## Customer Mapping

WhatsApp customers are identified by `tenantId + phoneNumber`:

- Same phone number in same tenant → same customer
- Same phone number in different tenant → different customer
- Prevents cross-tenant data access

## Idempotency

WhatsApp may retry webhook deliveries. The system uses the external WhatsApp message ID as the idempotency key:

- Same `externalMessageId` → processed once
- Duplicate webhook → no duplicate AI response
- No duplicate customer messages
- No duplicate commerce actions

## Security

- WhatsApp credentials are server-side only
- Access tokens stored in database are never exposed via API
- Webhook signature verification required
- Tenant isolation enforced
- No arbitrary tool execution
- No arbitrary database access from AI
- Safe error responses (no internal details exposed)

## Render Deployment

The webhook URL pattern for production:

```
https://<render-service-domain>/api/webhooks/whatsapp
```

Configure this URL in the Meta Developer Portal under:
**WhatsApp → Configuration → Webhook URL**

## Meta Configuration (Required for Live Testing)

1. Create a Meta Developer account at [developers.facebook.com](https://developers.facebook.com)
2. Create a new app with "Business" type
3. Add WhatsApp product to the app
4. Configure webhook URL: `https://<domain>/api/webhooks/whatsapp`
5. Set verify token (must match `WHATSAPP_VERIFY_TOKEN`)
6. Subscribe to `messages` webhook field
7. Copy access token to `WHATSAPP_ACCESS_TOKEN`
8. Copy phone number ID to `WHATSAPP_PHONE_NUMBER_ID`
9. Copy app secret to `WHATSAPP_APP_SECRET`

## Message Types

### Supported
- Text messages

### Unsupported (safely ignored)
- Images
- Audio
- Video
- Documents
- Location
- Interactive messages
- Reactions

Unsupported messages are acknowledged but not processed.

## Shared Commerce Engine

Website and WhatsApp use the **same** AI commerce engine:

```
Website → UnifiedMessage(channel="web") → processMessage()
WhatsApp → UnifiedMessage(channel="whatsapp") → processMessage()
```

Both channels use:
- Same commerce tools (`search_products`, `get_product`, `get_variant`, `check_stock`)
- Same system prompt with truthfulness rules
- Same deterministic commerce service
- Same tenant isolation

## Multi-Turn Conversations

WhatsApp conversations preserve context:

1. Customer sends message → persisted in `Message` table
2. AI receives conversation history (last 20 messages)
3. AI responds with context from previous messages
4. Response persisted → available for next turn

Example:
```
Customer: "Do you have black shoes?"
AI: "Yes, we have several black shoes. What size?"
Customer: "Size 42"
AI: [knows context about black shoes, checks size 42]
```

## Idempotency

WhatsApp may retry webhook deliveries. The system prevents duplicate processing:

- External WhatsApp message ID used as idempotency key
- `Message.externalId` field stores the WhatsApp message ID
- Duplicate messages are detected before AI processing
- Same message → at most one AI response

## Provider Failure Handling

If WhatsApp API returns an error:
- Error is logged safely (no tokens exposed)
- Message is still persisted in database
- Processing continues for other messages
- No application crash

## Implemented in Code

- WhatsApp provider abstraction (`lib/channels/whatsapp/provider.ts`)
- Webhook verification (`lib/channels/whatsapp/webhook.ts`)
- Message parsing (`lib/channels/whatsapp/parser.ts`)
- Tenant resolution (`lib/channels/whatsapp/adapter.ts`)
- Message processing (`lib/channels/whatsapp/processor.ts`)
- Webhook routes (`app/api/webhooks/whatsapp/route.ts`)
- Database model (`WhatsAppConnection`)
- Unit tests (145+ tests)

## Requires Real External Configuration

- Meta Developer App configuration
- Real WhatsApp Business number
- Real webhook delivery from Meta
- Real outbound WhatsApp message
- Live PostgreSQL database
- Groq API key for AI processing
