<?php
/**
 * Plugin Name: Karta
 * Plugin URI: https://karta.ai
 * Description: Connect your WooCommerce store to Karta AI commerce platform.
 * Version: 0.1.0
 * Author: Karta
 * License: GPL v2 or later
 * Text Domain: karta
 */

if (!defined('ABSPATH')) {
    exit;
}

// Define plugin constants
define('KARTA_PLUGIN_DIR', plugin_dir_path(__FILE__));
define('KARTA_PLUGIN_URL', plugin_dir_url(__FILE__));
define('KARTA_VERSION', '0.1.0');

// Check for WooCommerce dependency
add_action('admin_init', 'karta_check_woocommerce_dependency');

function karta_check_woocommerce_dependency() {
    if (!class_exists('WooCommerce')) {
        add_action('admin_notices', 'karta_woocommerce_missing_notice');
        deactivate_plugins(plugin_basename(__FILE__));
    }
}

function karta_woocommerce_missing_notice() {
    echo '<div class="error"><p><strong>Karta</strong> requires WooCommerce to be installed and activated.</p></div>';
}

// Include required files
require_once KARTA_PLUGIN_DIR . 'includes/class-karta-settings.php';
require_once KARTA_PLUGIN_DIR . 'includes/class-karta-api.php';
require_once KARTA_PLUGIN_DIR . 'includes/class-karta-products.php';
require_once KARTA_PLUGIN_DIR . 'includes/class-karta-webhooks.php';
require_once KARTA_PLUGIN_DIR . 'includes/class-karta-ajax.php';
require_once KARTA_PLUGIN_DIR . 'includes/class-karta-widget.php';

// Initialize plugin
add_action('init', 'karta_init_plugin');

function karta_init_plugin() {
    Karta_Settings::init();
    Karta_Products::init();
    Karta_Webhooks::init();
    Karta_Ajax::init();
    Karta_Widget::init();
}

// Register REST API endpoint for WooCommerce webhooks
add_action('rest_api_init', 'karta_register_rest_routes');

function karta_register_rest_routes() {
    register_rest_route('karta/v1', '/webhook', [
        'methods' => 'POST',
        'callback' => 'karta_handle_webhook',
        'permission_callback' => '__return_true', // Auth handled inside via HMAC
    ]);
}

function karta_handle_webhook($request) {
    return Karta_Webhooks::process_webhook($request);
}

// Add settings link to plugins page
add_filter('plugin_action_links_' . plugin_basename(__FILE__), 'karta_add_settings_link');

function karta_add_settings_link($links) {
    $settings_link = '<a href="' . admin_url('options-general.php?page=karta') . '">Settings</a>';
    array_unshift($links, $settings_link);
    return $links;
}
