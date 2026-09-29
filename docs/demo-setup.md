# Demo Site Token Setup

## Overview

The demo chat at `/demo/chat` requires a `NEXT_PUBLIC_DEMO_SITE_TOKEN` environment variable to authenticate with the Karta API.

## What is the Site Token?

The site token is a **public identifier** (NOT a secret) that:
- Maps to a specific Karta tenant
- Is safe to expose in browser code (like a public API key)
- Is used to resolve the tenant for the demo

## How to Get the Demo Site Token

### Option 1: Query the Database

Connect to your Render PostgreSQL database and run:

```sql
SELECT c.connectionId, t.name as tenant_name, t.slug
FROM woocommerce_connections c
JOIN tenants t ON c.tenantId = t.id
WHERE t.slug = 'karta-demo-store';
```

The `connectionId` is the value you need for `NEXT_PUBLIC_DEMO_SITE_TOKEN`.

### Option 2: Use the Karta Dashboard

1. Open the Karta dashboard
2. Navigate to the WooCommerce integration section
3. Copy the displayed Connection ID

## Configure Render

1. Go to your Render dashboard
2. Select the Karta service
3. Go to **Settings** → **Environment**
4. Add or update the environment variable:
   - **Key:** `NEXT_PUBLIC_DEMO_SITE_TOKEN`
   - **Value:** The connectionId from the database query above
5. Click **Save Changes**
6. Trigger a **Manual Deploy** → **Deploy latest commit**

## Verify the Setup

1. Open `https://karta-ozla.onrender.com/demo/chat`
2. The page should show the chat interface (not the configuration error)
3. Type "Hi" and click Send
4. You should see a real AI response

## Security Notes

- The site token is NOT a secret
- It only resolves to a tenant ID
- It cannot be used to access or modify data without proper authentication
- The actual WooCommerce API credentials remain server-side only
