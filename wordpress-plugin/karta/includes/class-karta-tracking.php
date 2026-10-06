<?php
/**
 * Karta Customer Behavior Tracking
 *
 * Tracks customer behavior on the store:
 * - Product views (which products a customer views repeatedly)
 * - Search queries (what they search for in the AI chat)
 * - Add-to-cart events
 *
 * This data is sent to Karta Cloud so the AI can deliver the correct
 * product recommendations based on the customer's demonstrated interest.
 */

if (!defined('ABSPATH')) {
    exit;
}

class Karta_Tracking {

    public static function init() {
        // Track product views on the frontend
        add_action('wp', [__CLASS__, 'track_product_view']);

        // Track behavior via AJAX (from the chat widget)
        add_action('wp_ajax_karta_track_behavior', [__CLASS__, 'ajax_track_behavior']);
        add_action('wp_ajax_nopriv_karta_track_behavior', [__CLASS__, 'ajax_track_behavior']);

        // Send behavior data to Karta Cloud when a chat message is sent
        add_action('wp_ajax_karta_send_message', [__CLASS__, 'ajax_send_message'], 5);
        add_action('wp_ajax_nopriv_karta_send_message', [__CLASS__, 'ajax_send_message'], 5);
    }

    /**
     * Track when a customer views a product page.
     */
    public static function track_product_view() {
        if (!is_product() || is_admin()) {
            return;
        }

        global $product;
        if (!$product) {
            return;
        }

        $visitor_id = self::get_visitor_id();
        $product_id = $product->get_id();

        // Store locally
        self::store_behavior($visitor_id, 'product_view', $product_id);

        // Also store in session for quick access
        if (!session_id()) {
            @session_start();
        }
        if (!isset($_SESSION['karta_views'])) {
            $_SESSION['karta_views'] = [];
        }
        $_SESSION['karta_views'][$product_id] = ($_SESSION['karta_views'][$product_id] ?? 0) + 1;
    }

    /**
     * AJAX handler for tracking behavior from the chat widget.
     */
    public static function ajax_track_behavior() {
        $nonce = isset($_POST['nonce']) ? sanitize_text_field(wp_unslash($_POST['nonce'])) : '';
        if (!wp_verify_nonce($nonce, 'karta_cart_nonce')) {
            wp_send_json_error(['message' => 'Invalid nonce.']);
        }

        $visitor_id = isset($_POST['visitorId']) ? sanitize_text_field(wp_unslash($_POST['visitorId'])) : '';
        $event_type = isset($_POST['eventType']) ? sanitize_text_field(wp_unslash($_POST['eventType'])) : '';
        $product_id = isset($_POST['productId']) ? intval($_POST['productId']) : 0;
        $search_query = isset($_POST['searchQuery']) ? sanitize_text_field(wp_unslash($_POST['searchQuery'])) : '';

        if (empty($visitor_id) || empty($event_type)) {
            wp_send_json_error(['message' => 'Missing parameters.']);
        }

        self::store_behavior($visitor_id, $event_type, $product_id, $search_query);

        wp_send_json_success(['message' => 'Tracked.']);
    }

    /**
     * AJAX handler that forwards chat messages to Karta Cloud with behavior context.
     */
    public static function ajax_send_message() {
        $nonce = isset($_POST['nonce']) ? sanitize_text_field(wp_unslash($_POST['nonce'])) : '';
        if (!wp_verify_nonce($nonce, 'karta_cart_nonce')) {
            wp_send_json_error(['message' => 'Invalid nonce.']);
        }

        $visitor_id = isset($_POST['visitorId']) ? sanitize_text_field(wp_unslash($_POST['visitorId'])) : '';
        $message = isset($_POST['message']) ? sanitize_textarea_field(wp_unslash($_POST['message'])) : '';
        $conversation_id = isset($_POST['conversationId']) ? sanitize_text_field(wp_unslash($_POST['conversationId'])) : '';

        if (empty($visitor_id) || empty($message)) {
            wp_send_json_error(['message' => 'Missing parameters.']);
        }

        // Track the search/query
        self::store_behavior($visitor_id, 'search', 0, $message);

        // Get behavior context for the AI
        $behavior = Karta_Database::get_visitor_behavior($visitor_id);
        $viewed_products = [];
        foreach ($behavior['product_views'] as $view) {
            $viewed_products[] = (int) $view->product_id;
        }

        // Forward to Karta Cloud
        $api_url = Karta_Settings::get_api_url();
        if (empty($api_url)) {
            wp_send_json_error(['message' => 'Karta API not configured.']);
        }

        $response = wp_remote_post($api_url . '/api/chat', [
            'headers' => Karta_API::get_headers(),
            'timeout' => 30,
            'body' => json_encode([
                'message' => $message,
                'visitorId' => $visitor_id,
                'siteToken' => Karta_Settings::get_connection_id(),
                'conversationId' => $conversation_id,
                'viewedProducts' => $viewed_products,
                'priorityProducts' => Karta_Settings::get_priority_products(),
            ]),
        ]);

        if (is_wp_error($response)) {
            wp_send_json_error(['message' => $response->get_error_message()]);
        }

        $body = json_decode(wp_remote_retrieve_body($response), true);
        $status_code = wp_remote_retrieve_response_code($response);

        if ($status_code < 200 || $status_code >= 300) {
            $error_message = isset($body['error']) ? $body['error'] : 'Unknown error';
            wp_send_json_error(['message' => $error_message]);
        }

        // Record the conversation locally
        Karta_Conversations::record_message($conversation_id, 'user', $message);
        if (!empty($body['message'])) {
            Karta_Conversations::record_message($conversation_id, 'assistant', $body['message']);
        }

        wp_send_json_success($body);
    }

    /**
     * Store a behavior event in the local database.
     */
    private static function store_behavior($visitor_id, $event_type, $product_id = 0, $search_query = '') {
        global $wpdb;
        $table = Karta_Database::get_behavior_table();

        $wpdb->insert($table, [
            'visitor_id' => $visitor_id,
            'event_type' => $event_type,
            'product_id' => $product_id > 0 ? $product_id : null,
            'search_query' => $search_query ?: null,
            'created_at' => current_time('mysql'),
        ]);
    }

    /**
     * Get or create a visitor ID from the cookie.
     */
    public static function get_visitor_id() {
        if (!session_id()) {
            @session_start();
        }
        if (empty($_SESSION['karta_visitor_id'])) {
            $_SESSION['karta_visitor_id'] = 'kvid_' . wp_generate_password(32, false);
        }
        return $_SESSION['karta_visitor_id'];
    }
}
