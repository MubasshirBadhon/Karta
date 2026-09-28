<?php
/**
 * Karta Settings Page
 *
 * Handles the WordPress admin settings page for Karta connection.
 */

if (!defined('ABSPATH')) {
    exit;
}

class Karta_Settings {

    private static $option_group = 'karta_settings';
    private static $page_slug = 'karta';

    public static function init() {
        add_action('admin_menu', [__CLASS__, 'add_settings_page']);
        add_action('admin_init', [__CLASS__, 'register_settings']);
        add_action('admin_enqueue_scripts', [__CLASS__, 'enqueue_admin_assets']);
    }

    public static function add_settings_page() {
        add_options_page(
            'Karta',
            'Karta',
            'manage_options',
            self::$page_slug,
            [__CLASS__, 'render_settings_page']
        );
    }

    public static function register_settings() {
        register_setting(self::$option_group, 'karta_api_url', [
            'type' => 'string',
            'sanitize_callback' => 'esc_url_raw',
            'default' => '',
        ]);
        register_setting(self::$option_group, 'karta_connection_id', [
            'type' => 'string',
            'sanitize_callback' => 'sanitize_text_field',
            'default' => '',
        ]);
        register_setting(self::$option_group, 'karta_secret', [
            'type' => 'string',
            'sanitize_callback' => 'sanitize_text_field',
            'default' => '',
        ]);
    }

    public static function enqueue_admin_assets($hook) {
        if ($hook !== 'settings_page_karta') {
            return;
        }
        wp_enqueue_style(
            'karta-admin',
            KARTA_PLUGIN_URL . 'admin/admin.css',
            [],
            KARTA_VERSION
        );
        wp_enqueue_script(
            'karta-admin',
            KARTA_PLUGIN_URL . 'admin/admin.js',
            ['jquery'],
            KARTA_VERSION,
            true
        );
        wp_localize_script('karta-admin', 'kartaAjax', [
            'ajaxUrl' => admin_url('admin-ajax.php'),
            'nonce'   => wp_create_nonce('karta_admin_nonce'),
        ]);
    }

    public static function render_settings_page() {
        if (!current_user_can('manage_options')) {
            return;
        }

        $api_url = get_option('karta_api_url', '');
        $connection_id = get_option('karta_connection_id', '');
        $secret = get_option('karta_secret', '');
        $is_connected = !empty($api_url) && !empty($connection_id) && !empty($secret);

        include KARTA_PLUGIN_DIR . 'admin/settings.php';
    }

    /**
     * Get the Karta API URL.
     */
    public static function get_api_url() {
        return rtrim(get_option('karta_api_url', ''), '/');
    }

    /**
     * Get the connection ID.
     */
    public static function get_connection_id() {
        return get_option('karta_connection_id', '');
    }

    /**
     * Get the connection secret.
     */
    public static function get_secret() {
        return get_option('karta_secret', '');
    }

    /**
     * Check if the plugin is configured.
     */
    public static function is_configured() {
        return !empty(self::get_api_url()) && !empty(self::get_connection_id()) && !empty(self::get_secret());
    }

    /**
     * Clear all settings (disconnect).
     */
    public static function disconnect() {
        delete_option('karta_api_url');
        delete_option('karta_connection_id');
        delete_option('karta_secret');
    }
}
