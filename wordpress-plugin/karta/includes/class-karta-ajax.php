<?php
/**
 * Karta AJAX Handlers
 *
 * Handles WordPress admin AJAX requests for Karta.
 */

if (!defined('ABSPATH')) {
    exit;
}

class Karta_Ajax {

    public static function init() {
        add_action('wp_ajax_karta_test_connection', [__CLASS__, 'ajax_test_connection']);
    }

    /**
     * AJAX handler for testing the Karta connection.
     */
    public static function ajax_test_connection() {
        check_ajax_referer('karta_admin_nonce', 'nonce');

        if (!current_user_can('manage_options')) {
            wp_send_json_error(['message' => 'Permission denied.']);
        }

        $result = Karta_API::test_connection();

        if (is_wp_error($result)) {
            wp_send_json_error(['message' => $result->get_error_message()]);
        }

        wp_send_json_success($result);
    }
}
