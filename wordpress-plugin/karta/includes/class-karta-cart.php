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
        // Cart-restore link for WhatsApp customers (?karta-cart=<token>)
        add_action('template_redirect', [__CLASS__, 'handle_cart_restore']);
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
     *   "quantity": 1,             // 1-20 (optional, default 1)
     *   "inventoryMode": "unlimited" // Karta's inventory policy (optional)
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

        // Karta's inventory policy travels with the confirmed cart action
        // from the chat API. "unlimited" = the merchant does not use
        // WooCommerce as quantity inventory control, so quantity must not
        // block the add. (WooCommerce still validates stock at checkout,
        // so this cannot create orders for unavailable products.)
        $inventory_mode = (string) $request->get_param('inventoryMode');
        $unlimited_inventory = ($inventory_mode === 'unlimited');

        if ($product_id <= 0) {
            return new WP_Error('invalid_product', 'Invalid product.', ['status' => 400]);
        }

        // Validate the product against WooCommerce (source of truth for
        // the product itself). Stock-related checks are policy-aware:
        // - unlimited mode: only structural checks (exists, published,
        //   price set) — quantity NEVER blocks the add
        // - managed mode: WooCommerce's full purchasable/in-stock validation
        $product = wc_get_product($product_id);
        if (!$product) {
            return new WP_Error('invalid_product', 'Product not found.', ['status' => 404]);
        }
        if ($product->get_status() !== 'publish') {
            return new WP_Error('unavailable_product', 'Product is not available.', ['status' => 400]);
        }

        if ($unlimited_inventory) {
            // Keep the price part of purchasability, skip the stock part —
            // never blindly bypass all safety checks.
            if ('' === $product->get_price()) {
                return new WP_Error('unavailable_product', 'Product cannot be purchased.', ['status' => 400]);
            }
        } else {
            if (!$product->is_purchasable()) {
                return new WP_Error('unavailable_product', 'Product cannot be purchased.', ['status' => 400]);
            }
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
            if (!$unlimited_inventory && !$variation->is_in_stock()) {
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
            // Structured failure log — cart session could not be initialized
            error_log(sprintf(
                '[KARTA CART FAIL] operation=cart_init product_id=%d variation_id=%d inventory_mode=%s correlation=%s',
                $product_id,
                $variation_id,
                $unlimited_inventory ? 'unlimited' : 'managed',
                substr(md5((string) $request->get_header('x_karta_nonce')), 0, 8)
            ));
            return new WP_Error('cart_unavailable', 'Cart is not available.', ['status' => 500]);
        }

        $cart_item_key = WC()->cart->add_to_cart(
            $product_id,
            $quantity,
            $variation_id > 0 ? $variation_id : 0,
            $attributes
        );

        if (!$cart_item_key) {
            // Structured failure log (PHASE 9 observability): enough to
            // diagnose, never any secrets/tokens/passwords/payment data.
            // A short correlation hash of the cart token is logged, not
            // the token itself.
            error_log(sprintf(
                '[KARTA CART FAIL] operation=add_to_cart product_id=%d variation_id=%d quantity=%d inventory_mode=%s correlation=%s',
                $product_id,
                $variation_id,
                $quantity,
                $unlimited_inventory ? 'unlimited' : 'managed',
                substr(md5((string) $request->get_header('x_karta_nonce')), 0, 8)
            ));
            return new WP_Error('add_failed', 'Could not add the product to the cart.', ['status' => 500]);
        }

        // Return the REAL WooCommerce cart state (Woo is the source of truth)
        $added_product = wc_get_product($variation_id > 0 ? $variation_id : $product_id);

        return [
            'success' => true,
            'item' => [
                'name' => $added_product ? $added_product->get_name() : '',
                'quantity' => $quantity,
                'price' => (float) ($added_product ? $added_product->get_price() : 0),
            ],
            'cart' => [
                'count' => (int) WC()->cart->get_cart_contents_count(),
                'subtotal' => (float) WC()->cart->get_subtotal('edit'),
                'total' => (float) WC()->cart->get_total('edit'),
            ],
            // Actual WooCommerce cart and checkout pages
            'cartUrl' => function_exists('wc_get_cart_url') ? wc_get_cart_url() : home_url('/cart/'),
            'checkoutUrl' => function_exists('wc_get_checkout_url') ? wc_get_checkout_url() : home_url('/checkout/'),
        ];
    }

    /**
     * Cart-restore handler for WhatsApp customers.
     *
     * WhatsApp customers have no browser session, so their persistent
     * Karta-side cart (?karta-cart=<cartToken>) is materialized into the
     * visitor's REAL WooCommerce session cart when they open the link:
     * the stored items are fetched from Karta Cloud (HMAC-authenticated),
     * added with Woo-native cart APIs, and the visitor is redirected to
     * the actual WooCommerce checkout page.
     */
    public static function handle_cart_restore() {
        if (empty($_GET['karta-cart']) || !class_exists('WooCommerce')) {
            return;
        }

        $cart_token = sanitize_text_field(wp_unslash($_GET['karta-cart']));
        if (empty($cart_token)) {
            return;
        }

        // Fetch the stored cart from Karta Cloud (server-to-server, HMAC)
        $api_url = Karta_Settings::get_api_url();
        $fetched = Karta_API::get_customer_cart($cart_token);

        if (is_wp_error($fetched) || empty($fetched['items'])) {
            // Cart unavailable — go to the normal cart page
            wp_safe_redirect(function_exists('wc_get_cart_url') ? wc_get_cart_url() : home_url('/cart/'));
            exit;
        }

        // Materialize into the visitor's real WooCommerce session cart
        if (function_exists('wc_load_cart') && !WC()->cart) {
            wc_load_cart();
        }

        if (WC()->cart) {
            foreach ($fetched['items'] as $item) {
                $product_id = isset($item['productId']) ? (int) $item['productId'] : 0;
                $variation_id = isset($item['variationId']) ? (int) $item['variationId'] : 0;
                $quantity = isset($item['quantity']) ? max(1, min(20, (int) $item['quantity'])) : 1;

                if ($product_id <= 0) {
                    continue;
                }

                $attributes = [];
                if ($variation_id > 0) {
                    $attributes = wc_get_product_variation_attributes($variation_id);
                }

                // Woo-native add (Woo validates purchasability/stock itself);
                // items already in the cart keep their quantity
                $in_cart = WC()->cart->get_cart_item($cart_token . '_' . $product_id . '_' . $variation_id);
                if (!$in_cart) {
                    WC()->cart->add_to_cart($product_id, $quantity, $variation_id, $attributes);
                }
            }
        }

        // Redirect to the actual WooCommerce checkout page
        wp_safe_redirect(function_exists('wc_get_checkout_url') ? wc_get_checkout_url() : home_url('/checkout/'));
        exit;
    }
}
