# Karta Investor Demo Runbook

## Overview

This document is the practical runbook for the Karta investor demo.

**Status Legend:**
- **implemented** — Working in the current codebase
- **requires external credentials** — Needs real API keys or accounts

---

## Before the Demo

### Prerequisites

- [ ] Render service running
- [ ] PostgreSQL connected
- [ ] Environment variables configured
- [ ] WooCommerce connected
- [ ] Products synced
- [ ] Meta WhatsApp configured
- [ ] Webhook configured
- [ ] Groq configured

### Environment Variables

Required in `.env`:

```env
# Database
DATABASE_URL=

# AI Provider
GROQ_API_KEY=

# WordPress Connector
WORDPRESS_CONNECT_SECRET=

# WhatsApp
WHATSAPP_ACCESS_TOKEN=
WHATSAPP_VERIFY_TOKEN=
WHATSAPP_PHONE_NUMBER_ID=
WHATSAPP_BUSINESS_ACCOUNT_ID=
WHATSAPP_API_VERSION=v18.0
WHATSAPP_APP_SECRET=
```

### Setup Steps

1. Deploy to Render
2. Create PostgreSQL database
3. Run `pnpm prisma db push` to create tables
4. Run `pnpm prisma db seed` to create demo data (optional)
5. Configure WooCommerce connection
6. Sync products
7. Configure WhatsApp webhook
8. Test the flow

---

## Demo Part 1: Store Sync

**Goal:** Show WooCommerce → Karta

1. Open Karta dashboard
2. Show connected WooCommerce store
3. Show synced product count
4. Navigate to Products page
5. Show product list with prices, stock, variants

**What the investor sees:**
- Real WooCommerce products in Karta
- Product images, names, prices
- Stock levels
- Variants (sizes, colors)

---

## Demo Part 2: Website AI

**Goal:** Show AI answering product questions with real data

1. Open `/demo/chat`
2. Ask: "Do you have black shoes under 5000 taka?"
3. Show AI response with real products
4. Ask: "Do you have size 42?"
5. Show AI checking variant/stock
6. Ask: "Is it in stock?"
6. Show AI response with stock info

**What the investor sees:**
- AI using real product data
- Variant/stock lookup
- Natural conversation flow
- Context preservation

---

## Demo Part 3: WhatsApp

**Goal:** Show real WhatsApp message → AI → WhatsApp reply

1. Send WhatsApp message to business number
2. Show webhook receiving message
3. Show tenant resolution
4. Show AI processing
5. Show response sent back via WhatsApp
6. Send follow-up question
7. Show conversation context preserved

**What the investor sees:**
- Real WhatsApp message flow
- Same AI engine as website
- Real product data in responses
- Conversation continuity

---

## Demo Part 4: Follow-up

**Goal:** Show multi-turn conversation

1. Ask about a product
2. Ask follow-up requiring context
3. Show AI remembering previous context
4. Show same commerce intelligence as website

---

## Architecture

```
Website → UnifiedMessage(channel="web") → processMessage()
WhatsApp → UnifiedMessage(channel="whatsapp") → processMessage()
```

Both channels use:
- Same commerce tools
- Same system prompt
- Same deterministic commerce service
- Same tenant isolation

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Webhook verification fails | Check `WHATSAPP_VERIFY_TOKEN` matches Meta app |
| Database connection fails | Check `DATABASE_URL` |
| Groq failure | Check `GROQ_API_KEY` |
| WhatsApp provider failure | Check `WHATSAPP_ACCESS_TOKEN` and `WHATSAPP_PHONE_NUMBER_ID` |
| WooCommerce sync fails | Check `WORDPRESS_CONNECT_SECRET` and connection |
| Products not showing | Run `pnpm prisma db push` and seed |

---

## What Has Been Tested

- Unit tests: 150+ tests passing
- TypeScript: passing
- ESLint: passing
- Production build: passing
- Prisma generate: passing

## What Requires Live Testing

- Real Render deployment
- Real PostgreSQL connection
- Real WooCommerce connection
- Real product sync
- Real Groq API calls
- Real Meta webhook verification
- Real inbound WhatsApp message
- Real outbound WhatsApp reply
- Complete end-to-end flow
