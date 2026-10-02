<?php
/**
 * Karta API Client
 *
 * Handles all communication between WordPress and Karta Cloud.
 * This is a thin connector — no AI logic, no commerce engine.
 */

if (!defined('ABSPATH')) {
    exit;
}

class Karta_API {

    private static function get_headers() {
        $connection_id = Karta_Settings::get_connection_id();
        $secret = Karta_Settings::get_secret();
        $timestamp = (string) time();

        // Create HMAC signature for authentication using per-connection secret
        $signature = hash_hmac('sha256', $connection_id . $timestamp, $secret);

        return [
            'Content-Type' => 'application/json',
            'X-Karta-Connection-Id' => $connection_id,
            'X-Karta-Timestamp' => $timestamp,
            'X-Karta-Signature' => $signature,
        ];
    }

    /**
     * Make an authenticated request to the Karta API.
     */
    private static function request($endpoint, $method = 'GET', $body = null) {
        $api_url = Karta_Settings::get_api_url();
        if (empty($api_url)) {
            return new WP_Error('not_configured', 'Karta API URL is not configured.');
        }

        $url = $api_url . $endpoint;
        $headers = self::get_headers();

        $args = [
            'method'  => $method,
            'headers' => $headers,
            'timeout' => 30,
        ];

        if ($body !== null) {
            $args['body'] = json_encode($body);
        }

        $response = wp_remote_request($url, $args);

        if (is_wp_error($response)) {
            return $response;
        }

        $status_code = wp_remote_retrieve_response_code($response);
        $body = json_decode(wp_remote_retrieve_body($response), true);

        if ($status_code < 200 || $status_code >= 300) {
            $error_message = isset($body['error']) ? $body['error'] : 'Unknown error';
            return new WP_Error('api_error', $error_message, ['status' => $status_code]);
        }

        return $body;
    }

    /**
     * Test the connection to Karta Cloud.
     */
    public static function test_connection() {
        return self::request('/api/integrations/woocommerce/auth/test', 'POST');
    }

    /**
     * Commerce diagnostics from Karta Cloud (connection, sync, counts,
     * inventory mode, WhatsApp status). No secrets in the response.
     */
    public static function diagnostics() {
        return self::request('/api/integrations/woocommerce/diagnostics', 'GET');
    }

    /**
     * Sync products to Karta Cloud.
     *
     * $is_final_batch marks the LAST batch of a full sync (the Karta side
     * reconciles/archives only then); $seen_external_ids carries the
     * complete list of external IDs seen across the whole sync.
     */
    public static function sync_products($products, $is_final_batch = false, $seen_external_ids = []) {
        return self::request('/api/integrations/woocommerce/products/sync', 'POST', [
            'products' => $products,
            'sync' => [
                'isFinalBatch' => (bool) $is_final_batch,
                'seenExternalIds' => array_values(array_map('strval', $seen_external_ids)),
            ],
        ]);
    }

    /**
     * Register a webhook with Karta Cloud.
     */
    public static function register_webhook($topic, $callback_url) {
        return self::request('/api/integrations/woocommerce/webhooks/register', 'POST', [
            'topic' => $topic,
            'callback_url' => $callback_url,
        ]);
    }

    /**
     * Fetch a WhatsApp customer's stored cart from Karta Cloud.
     * Used by the cart-restore handler when the customer opens their
     * personal cart link.
     */
    public static function get_customer_cart($cart_token) {
        $api_url = Karta_Settings::get_api_url();
        if (empty($api_url)) {
            return new WP_Error('not_configured', 'Karta API URL is not configured.');
        }

        $url = $api_url . '/api/integrations/woocommerce/cart?token=' . rawurlencode($cart_token);
        $response = wp_remote_get($url, [
            'headers' => self::get_headers(),
            'timeout' => 30,
        ]);

        if (is_wp_error($response)) {
            return $response;
        }

        $status_code = wp_remote_retrieve_response_code($response);
        $body = json_decode(wp_remote_retrieve_body($response), true);

        if ($status_code < 200 || $status_code >= 300) {
            $error_message = isset($body['error']) ? $body['error'] : 'Unknown error';
            return new WP_Error('api_error', $error_message, ['status' => $status_code]);
        }

        return $body;
    }

    /**
     * Notify Karta Cloud that a product was deleted in WooCommerce.
     * Karta archives the product (soft deletion) so it is never
     * recommended or shown again.
     */
    public static function delete_product($external_id) {
        return self::request('/api/integrations/woocommerce/webhooks', 'POST', [
            'eventType' => 'product.deleted',
            'productId' => (string) $external_id,
        ]);
    }
}
