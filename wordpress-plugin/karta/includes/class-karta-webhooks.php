<?php
/**
 * Karta Webhooks
 *
 * Handles WooCommerce webhook registration and processing.
 */

if (!defined('ABSPATH')) {
    exit;
}

class Karta_Webhooks {

    public static function init() {
        // Register WooCommerce webhooks when connection is established
        add_action('karta_connection_established', [__CLASS__, 'register_webhooks']);
    }

    /**
     * Register WooCommerce webhooks with Karta Cloud.
     */
    public static function register_webhooks() {
        $callback_url = home_url('/wp-json/karta/v1/webhook');

        $topics = [
            'product.created',
            'product.updated',
            'product.deleted',
        ];

        foreach ($topics as $topic) {
            Karta_API::register_webhook($topic, $callback_url);
        }
    }

    /**
     * Process incoming webhook from WooCommerce.
     */
    public static function process_webhook($request) {
        $body = $request->get_body();
        $headers = $request->get_headers();

        // Get the topic from WooCommerce headers
        $topic = isset($headers['x_wc_webhook_topic']) ? $headers['x_wc_webhook_topic'][0] : '';
        $resource_id = isset($headers['x_wc_webhook_resource_id']) ? $headers['x_wc_webhook_resource_id'][0] : '';

        if (empty($topic)) {
            return new WP_Error('invalid_webhook', 'Missing webhook topic.', ['status' => 400]);
        }

        // Verify the webhook signature
        $signature = isset($headers['x_wc_webhook_signature']) ? $headers['x_wc_webhook_signature'][0] : '';
        $secret = Karta_Settings::get_secret();

        if (empty($signature) || empty($secret)) {
            return new WP_Error('unauthorized', 'Invalid webhook signature.', ['status' => 401]);
        }

        $expected_signature = base64_encode(hash_hmac('sha256', $body, $secret, true));

        if (!hash_equals($expected_signature, $signature)) {
            return new WP_Error('unauthorized', 'Invalid webhook signature.', ['status' => 401]);
        }

        // Parse the payload
        $payload = json_decode($body, true);
        if (empty($payload)) {
            return new WP_Error('invalid_payload', 'Invalid webhook payload.', ['status' => 400]);
        }

        // Normalize and sync the product
        $product = wc_get_product($payload['id']);
        $normalized = Karta_Products::normalize_product($product);

        if ($normalized) {
            Karta_API::sync_products([$normalized]);
        }

        return ['status' => 'success'];
    }
}
