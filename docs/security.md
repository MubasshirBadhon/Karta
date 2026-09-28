# Karta Security Rules

## Core Security Principles

### 1. Groq API Keys Are Server-Side Only
- The `GROQ_API_KEY` environment variable must only be accessed in server-side code (API routes, server components).
- Never expose the API key in client-side JavaScript, browser bundles, or public API responses.
- The AI provider module (`lib/ai/`) is only imported server-side.

### 2. WhatsApp Credentials Are Server-Side Only
- `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, and `WHATSAPP_BUSINESS_ACCOUNT_ID` must never be exposed to the browser.
- All WhatsApp API calls must originate from server-side handlers.

### 3. WordPress Must Never Receive Groq Credentials
- The WordPress plugin communicates with Karta Cloud via the REST API using per-connection secrets.
- Each WooCommerce connection has its own unique secret generated server-side.
- Groq API keys are never sent to or stored in WordPress.
- The WordPress plugin only sends product data and receives AI-generated responses.

### 4. Tenant Data Must Always Be Isolated
- Every database query must include a `tenantId` filter.
- The `validateTenantId()` function must be called before any commerce operation.
- Cross-tenant data access is strictly forbidden.

### 5. Incoming Webhooks Must Eventually Be Verified
- WhatsApp webhooks must verify the `X-Hub-Signature-256` header.
- WordPress webhooks must verify the signature using `WORDPRESS_CONNECT_SECRET`.
- Unverified webhook payloads must be rejected with a 401 response.

### 6. Client-Side Price/Stock Data Cannot Be Trusted
- Prices and stock levels displayed on the website are for presentation only.
- All transactional price/stock checks must be validated server-side through the commerce service.
- The AI must always use `checkStock()` and `getProduct()` — never trust client-submitted values.

### 7. AI Cannot Invent Product Prices
- The AI must always retrieve pricing from the commerce engine.
- If pricing data is unavailable, the AI must say so — never guess.

### 8. AI Cannot Invent Stock
- Stock levels must always come from `checkStock()`.
- The AI must never assume stock availability.

### 9. AI Cannot Invent Variants
- Variant information must always come from `getProduct()` or `getVariant()`.
- The AI must never fabricate variant names, attributes, or options.

### 10. AI Cannot Invent Discounts
- Discounts and promotions must be retrieved from the commerce engine.
- The AI must never create or suggest discounts that don't exist in the data.

### 11. AI Cannot Invent Specifications
- Product specifications must come from the product data in the database.
- The AI must never fabricate product details.

### 12. API Secrets Must Never Be Committed
- `.env` files must be listed in `.gitignore`.
- Only `.env.example` with placeholder values may be committed.
- Pre-commit hooks should scan for accidental secret commits.

### 13. Sensitive Credentials Must Not Be Logged
- API keys, tokens, and secrets must never appear in log output.
- Use the `redactSecrets()` utility before logging any object that might contain credentials.
- Error messages must not include raw API keys or tokens.
