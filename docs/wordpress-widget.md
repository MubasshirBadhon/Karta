# Karta WordPress Widget — Planned Integration

## Overview

This document describes the planned mechanism for injecting a Karta AI chat widget into the merchant's WordPress website. This is **not implemented in Phase 2** — it is preparation for Phase 3.

## Security Boundaries

The widget must **never** expose:
- Groq API key
- WordPress connection secret
- Internal API secrets
- Tenant ID (in client-side code)

## Planned Architecture

```
WordPress Website
├── Karta Widget (JavaScript)
│   └── Communicates with Karta Cloud
│       └── Uses a public site-scoped token
│
Karta Cloud
├── /api/chat (public endpoint)
│   └── Validates site token
│   └── Resolves tenant from token
│   └── Processes AI request
│   └── Returns AI response
```

## Token Mechanism

1. When the WordPress plugin connects to Karta, Karta generates a **site token**
2. This token is stored in WordPress options
3. The widget JavaScript receives this token (not the connection secret)
4. The token is scoped to the tenant and can be revoked

## Widget Injection Point

The plugin will enqueue a JavaScript file that:
1. Creates a chat widget container
2. Loads the Karta widget script from Karta Cloud
3. Initializes the widget with the site token

## Phase 3 Implementation

- [ ] Public chat API endpoint
- [ ] Site token generation and validation
- [ ] Widget JavaScript bundle
- [ ] WordPress enqueue mechanism
- [ ] AI response streaming
