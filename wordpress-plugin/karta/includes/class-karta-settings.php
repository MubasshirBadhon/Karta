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
        register_setting(self::$option_group, 'karta_ai_name', [
            'type' => 'string',
            'sanitize_callback' => 'sanitize_text_field',
            'default' => 'Karta AI',
        ]);
        register_setting(self::$option_group, 'karta_ai_color', [
            'type' => 'string',
            'sanitize_callback' => 'sanitize_hex_color',
            'default' => '#6366f1',
        ]);
        register_setting(self::$option_group, 'karta_currency', [
            'type' => 'string',
            'sanitize_callback' => 'sanitize_text_field',
            'default' => 'BDT',
        ]);
        register_setting(self::$option_group, 'karta_currency_symbol', [
            'type' => 'string',
            'sanitize_callback' => 'sanitize_text_field',
            'default' => '৳',
        ]);
        register_setting(self::$option_group, 'karta_priority_products', [
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
        $ai_name = get_option('karta_ai_name', 'Karta AI');
        $ai_color = get_option('karta_ai_color', '#6366f1');
        $currency = get_option('karta_currency', 'BDT');
        $currency_symbol = get_option('karta_currency_symbol', '৳');
        $priority_products = get_option('karta_priority_products', '');
        $is_connected = !empty($api_url) && !empty($connection_id) && !empty($secret);

        include KARTA_PLUGIN_DIR . 'admin/settings.php';
    }

    public static function get_api_url() {
        return rtrim(get_option('karta_api_url', ''), '/');
    }

    public static function get_connection_id() {
        return get_option('karta_connection_id', '');
    }

    public static function get_secret() {
        return get_option('karta_secret', '');
    }

    public static function get_ai_name() {
        return get_option('karta_ai_name', 'Karta AI');
    }

    public static function get_ai_color() {
        return get_option('karta_ai_color', '#6366f1');
    }

    public static function get_currency() {
        return get_option('karta_currency', 'BDT');
    }

    public static function get_currency_symbol() {
        return get_option('karta_currency_symbol', '৳');
    }

    public static function get_priority_products() {
        return get_option('karta_priority_products', '');
    }

    public static function is_configured() {
        return !empty(self::get_api_url()) && !empty(self::get_connection_id()) && !empty(self::get_secret());
    }

    public static function disconnect() {
        delete_option('karta_api_url');
        delete_option('karta_connection_id');
        delete_option('karta_secret');
    }
}
