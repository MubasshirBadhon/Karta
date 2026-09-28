# WooCommerce Connection Provisioning

## Overview

This document describes the merchant-facing WooCommerce connection provisioning flow.

## Flow

```
Merchant opens Karta Dashboard
    ↓
Navigates to WooCommerce Integration page
    ↓
Clicks "Connect WooCommerce"
    ↓
Enters WordPress site URL
    ↓
Server creates connection with generated credentials
    ↓
Dashboard displays:
  - Karta API URL
  - Connection ID
  - Connection Secret (shown once)
    ↓
Merchant copies credentials
    ↓
Opens WordPress admin → Settings → Karta
    ↓
Pastes credentials and clicks Connect
    ↓
Plugin authenticates with Karta
    ↓
Merchant clicks Sync Products
    ↓
Products sync to Karta
```

## API Endpoint

### POST /api/integrations/woocommerce/connections

Creates a new WooCommerce connection.

**Request:**
```json
{
  "siteUrl": "https://your-store.com",
  "siteName": "My Store"
}
```

**Response:**
```json
{
  "success": true,
  "connectionId": "kwc_abc123...",
  "connectionSecret": "a1b2c3d4...",
  "siteUrl": "https://your-store.com",
  "siteName": "My Store",
  "apiUrl": "https://karta-ozla.onrender.com"
}
```

### GET /api/integrations/woocommerce/connections

Lists connections for the tenant.

## Security

- Each connection has its own unique secret
- Secrets are generated using cryptographically secure randomness
- Secrets are never logged
- Secrets are never exposed in list APIs
- HMAC authentication uses per-connection secrets
- Tenant isolation is maintained

## WordPress Plugin

The plugin uses the credentials to authenticate:

```php
$connection_id = get_option('karta_connection_id');
$secret = get_option('karta_secret');
$timestamp = time();
$signature = hash_hmac('sha256', $connection_id . $timestamp, $secret);
```

## Dashboard URL

```
https://karta-ozla.onrender.com/dashboard/integrations/woocommerce
```
