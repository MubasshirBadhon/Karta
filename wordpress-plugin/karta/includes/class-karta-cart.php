<?php
/**
 * Karta Cart Bridge
 *
 * The thinnest secure bridge between the Karta website widget and the
 * merchant's WooCommerce cart.
 *
 * How it works:
 * - The Karta AI conversation resolves the exact WooCommerce product/
 *   variation deterministically and requires explicit customer
 *   confirmation before any cart action.
 * - The confirmed cart action is performed by the customer's own browser
 *   (same origin, session-aware) against this endpoint, so the item is
 *   added to THE CUSTOMER'S WooCommerce cart session.
 * - The request is protected by a per-session nonce (CSRF protection).
 *
 * WooCommerce remains responsible for: cart, checkout, tax, shipping,
 * payment, and order creation. Karta only orchestrates the shopping
 * conversation — no AI logic, no commerce engine here.
 */

if (!defined('ABSPATH')) {
    exit;
}

class Karta_Cart {

    public static function init() {
        add_action('rest_api_init', [__CLASS__, 'register_rest_routes']);
    }

    public static function register_rest_routes() {
        register_rest_route('karta/v1', '/cart/add', [
            'methods' => 'POST',
            'callback' => [__CLASS__, 'handle_add_to_cart'],
            'permission_callback' => [__CLASS__, 'check_permissions'],
        ]);
    }

    /**
     * Permission callback: verify the per-session nonce (CSRF protection).
     * The nonce is localized to the widget at page load.
     */
    public static function check_permissions($request) {
        $nonce = $request->get_header('x_karta_nonce');
        if (empty($nonce) || !wp_verify_nonce($nonce, 'karta_cart_nonce')) {
            return new WP_Error('invalid_nonce', 'Invalid or missing nonce.', ['status' => 403]);
        }
        return true;
    }

    /**
     * Add a confirmed product/variation to the customer's WooCommerce cart.
     *
     * Input (JSON body):
     * {
     *   "productId": 123,          // WooCommerce product ID (required)
     *   "variationId": 456,        // WooCommerce variation ID (optional)
     *   "quantity": 1              // 1-20 (optional, default 1)
     * }
     */
    public static function handle_add_to_cart($request) {
        if (!class_exists('WooCommerce')) {
            return new WP_Error('no_woocommerce', 'WooCommerce is not active.', ['status' => 500]);
        }

        $product_id = (int) $request->get_param('productId');
        $variation_id = (int) $request->get_param('variationId');
        $quantity = (int) $request->get_param('quantity');
        if ($quantity < 1) {
            $quantity = 1;
        }
        $quantity = min($quantity, 20);

        if ($product_id <= 0) {
            return new WP_Error('invalid_product', 'Invalid product.', ['status' => 400]);
        }

        // Validate the product against WooCommerce (source of truth)
        $product = wc_get_product($product_id);
        if (!$product) {
            return new WP_Error('invalid_product', 'Product not found.', ['status' => 404]);
        }
        if ($product->get_status() !== 'publish') {
            return new WP_Error('unavailable_product', 'Product is not available.', ['status' => 400]);
        }
        if (!$product->is_purchasable()) {
            return new WP_Error('unavailable_product', 'Product cannot be purchased.', ['status' => 400]);
        }

        // WooCommerce's own stock logic — respects the merchant's exact
        // stock management settings (managed, unmanaged, backorders).
        if (!$product->is_in_stock()) {
            return new WP_Error('out_of_stock', 'Product is out of stock.', ['status' => 400]);
        }

        // Variable products require a valid variation
        $attributes = [];
        if ($product->is_type('variable')) {
            if ($variation_id <= 0) {
                return new WP_Error('variation_required', 'Please choose product options.', ['status' => 400]);
            }
            $variation = wc_get_product($variation_id);
            if (!$variation || (int) $variation->get_parent_id() !== $product_id) {
                return new WP_Error('invalid_variation', 'Invalid product variation.', ['status' => 400]);
            }
            if (!$variation->is_in_stock()) {
                return new WP_Error('out_of_stock', 'Product variation is out of stock.', ['status' => 400]);
            }
            // Exact variation attributes (WooCommerce format) so the
            // correct variation is added to the cart.
            $attributes = wc_get_product_variation_attributes($variation_id);
        } elseif ($variation_id > 0) {
            return new WP_Error('invalid_variation', 'Product has no variations.', ['status' => 400]);
        }

        // Load the cart in REST context — the customer's session comes
        // from their own browser cookies (same-origin request).
        if (function_exists('wc_load_cart') && !WC()->cart) {
            wc_load_cart();
        }
        if (!WC()->cart) {
            return new WP_Error('cart_unavailable', 'Cart is not available.', ['status' => 500]);
        }

        $cart_item_key = WC()->cart->add_to_cart(
            $product_id,
            $quantity,
            $variation_id > 0 ? $variation_id : 0,
            $attributes
        );

        if (!$cart_item_key) {
            return new WP_Error('add_failed', 'Could not add the product to the cart.', ['status' => 500]);
        }

        return [
            'success' => true,
            'cartCount' => WC()->cart->get_cart_contents_count(),
            'cartUrl' => function_exists('wc_get_cart_url') ? wc_get_cart_url() : home_url('/cart/'),
        ];
    }
}
