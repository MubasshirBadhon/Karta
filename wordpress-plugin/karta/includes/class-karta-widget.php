<?php
/**
 * Karta Widget
 *
 * Frontend floating AI chat widget for the merchant's public website.
 *
 * - Loads only on the public frontend (never wp-admin or login screens)
 * - Assets are enqueued via WordPress APIs (no manual script pasting)
 * - Exposes only safe public configuration to the browser
 *   (no connection secret, no tenant ID, no credentials)
 * - Remains a thin connector — no AI logic lives here
 */

if (!defined('ABSPATH')) {
    exit;
}

class Karta_Widget {

    public static function init() {
        // wp_enqueue_scripts only fires on the public frontend,
        // never inside wp-admin or on the login screen.
        add_action('wp_enqueue_scripts', [__CLASS__, 'enqueue_assets']);
    }

    /**
     * Enqueue the floating chat widget on the public frontend.
     *
     * The widget is not loaded at all when the Karta connection
     * is not configured.
     */
    public static function enqueue_assets() {
        // Belt-and-braces guard: never render inside wp-admin.
        if (is_admin()) {
            return;
        }

        // Do not show the widget when the Karta connection is not configured.
        if (!Karta_Settings::is_configured()) {
            return;
        }

        wp_enqueue_style(
            'karta-widget',
            KARTA_PLUGIN_URL . 'assets/widget.css',
            [],
            KARTA_VERSION
        );

        wp_enqueue_script(
            'karta-widget',
            KARTA_PLUGIN_URL . 'assets/widget.js',
            [],
            KARTA_VERSION,
            true
        );

        // Only safe, public configuration is passed to the browser.
        // - siteToken: the connection's PUBLIC widget identifier (NOT a
        //   secret — per docs/demo-setup.md it is a public, revocable
        //   identifier used to resolve the store/tenant server-side)
        // - apiUrl/endpoint: the public Karta chat API location
        // - aiName/aiColor/currencySymbol: merchant-customizable appearance
        // The connection secret, tenant ID, and all credentials remain
        // server-side only.
        wp_localize_script('karta-widget', 'kartaWidget', [
            'apiUrl'    => Karta_Settings::get_api_url(),
            'endpoint'  => '/api/chat',
            'siteToken' => Karta_Settings::get_connection_id(),
            // Per-session nonce for the same-origin cart bridge (CSRF protection)
            'cartNonce' => wp_create_nonce('karta_cart_nonce'),
            'cartEndpoint' => home_url('/wp-json/karta/v1/cart/add'),
            // Merchant-customizable appearance
            'aiName' => Karta_Settings::get_ai_name(),
            'aiColor' => Karta_Settings::get_ai_color(),
            'currency' => Karta_Settings::get_currency(),
            'currencySymbol' => Karta_Settings::get_currency_symbol(),
            // Local WordPress AJAX endpoint (behavior tracking + conversation recording)
            'ajaxUrl' => admin_url('admin-ajax.php'),
            'trackEndpoint' => home_url('/wp-json/karta/v1/cart/add'),
        ]);
    }
}
