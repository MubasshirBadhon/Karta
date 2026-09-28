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

        // Create HMAC signature for authentication
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
     * Sync products to Karta Cloud.
     */
    public static function sync_products($products) {
        return self::request('/api/integrations/woocommerce/products/sync', 'POST', [
            'products' => $products,
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
}
