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
        // ═══════════════════════════════════════════════════════════════════════
        // TEMPORARY DIAGNOSTIC LOGGING - REMOVE AFTER DEBUGGING
        // ═══════════════════════════════════════════════════════════════════════
        $diag_start = microtime(true);
        $connection_id = Karta_Settings::get_connection_id();
        error_log(sprintf(
            '[KARTA DIAG] request() start | endpoint=%s | method=%s | connectionIdPrefix=%s | hasBody=%s',
            $endpoint,
            $method,
            $connection_id ? substr($connection_id, 0, 8) : 'none',
            $body !== null ? 'yes' : 'no'
        ));
        // ═══════════════════════════════════════════════════════════════════════

        $api_url = Karta_Settings::get_api_url();
        if (empty($api_url)) {
            // DIAG: Log configuration error
            error_log('[KARTA DIAG] request() failed: API URL not configured');
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

        // DIAG: Log before HTTP request
        error_log(sprintf(
            '[KARTA DIAG] wp_remote_request() calling | url=%s | timeout=%d',
            $url,
            $args['timeout']
        ));

        $response = wp_remote_request($url, $args);

        // DIAG: Log after HTTP request
        $diag_elapsed = round((microtime(true) - $diag_start) * 1000, 2);
        error_log(sprintf(
            '[KARTA DIAG] wp_remote_request() returned | elapsedMs=%s | isWpError=%s',
            $diag_elapsed,
            is_wp_error($response) ? 'yes' : 'no'
        ));

        if (is_wp_error($response)) {
            // DIAG: Log WP_Error details
            error_log(sprintf(
                '[KARTA DIAG] WP_Error | code=%s | message=%s',
                $response->get_error_code(),
                $response->get_error_message()
            ));
            return $response;
        }

        $status_code = wp_remote_retrieve_response_code($response);
        $body = json_decode(wp_remote_retrieve_body($response), true);

        // DIAG: Log response status
        error_log(sprintf(
            '[KARTA DIAG] response status=%d | bodyLength=%d',
            $status_code,
            strlen(wp_remote_retrieve_body($response))
        ));

        if ($status_code < 200 || $status_code >= 300) {
            $error_message = isset($body['error']) ? $body['error'] : 'Unknown error';
            // DIAG: Log HTTP error
            error_log(sprintf(
                '[KARTA DIAG] HTTP error | status=%d | error=%s',
                $status_code,
                $error_message
            ));
            return new WP_Error('api_error', $error_message, ['status' => $status_code]);
        }

        // DIAG: Log success
        error_log(sprintf(
            '[KARTA DIAG] request() success | endpoint=%s | elapsedMs=%s',
            $endpoint,
            $diag_elapsed
        ));

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
