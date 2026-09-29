<?php
/**
 * Karta Product Sync
 *
 * Retrieves WooCommerce products and sends them to Karta Cloud.
 */

if (!defined('ABSPATH')) {
    exit;
}

class Karta_Products {

    // Number of products per batch
    const BATCH_SIZE = 50;

    public static function init() {
        add_action('wp_ajax_karta_sync_products', [__CLASS__, 'ajax_sync_products']);
    }

    /**
     * AJAX handler for product sync.
     */
    public static function ajax_sync_products() {
        check_ajax_referer('karta_admin_nonce', 'nonce');

        if (!current_user_can('manage_options')) {
            wp_send_json_error(['message' => 'Permission denied.']);
        }

        $result = self::sync_all_products();

        if (is_wp_error($result)) {
            wp_send_json_error(['message' => $result->get_error_message()]);
        }

        wp_send_json_success($result);
    }

    /**
     * Sync all WooCommerce products to Karta Cloud.
     */
    public static function sync_all_products() {
        if (!class_exists('WC_Product')) {
            return new WP_Error('no_woocommerce', 'WooCommerce is not active.');
        }

        $page = 1;
        $total_synced = 0;
        $total_failed = 0;
        $has_more = true;

        while ($has_more) {
            $products = self::get_woocommerce_products($page, self::BATCH_SIZE);

            if (empty($products)) {
                $has_more = false;
                break;
            }

            $normalized = [];
            foreach ($products as $product) {
                $normalized_product = self::normalize_product($product);
                if ($normalized_product) {
                    $normalized[] = $normalized_product;
                }
            }

            if (!empty($normalized)) {
                $result = Karta_API::sync_products($normalized);

                if (is_wp_error($result)) {
                    $total_failed += count($normalized);
                } else {
                    $total_synced += count($normalized);
                }
            }

            if (count($products) < self::BATCH_SIZE) {
                $has_more = false;
            } else {
                $page++;
            }
        }

        // Update last sync time
        update_option('karta_last_sync_at', current_time('mysql'));

        return [
            'synced' => $total_synced,
            'failed' => $total_failed,
            'total' => $total_synced + $total_failed,
        ];
    }

    /**
     * Retrieve WooCommerce products.
     */
    private static function get_woocommerce_products($page = 1, $per_page = 50) {
        $args = [
            'limit' => $per_page,
            'page'  => $page,
            'status' => 'publish',
        ];

        $products = wc_get_products($args);
        return $products;
    }

    /**
     * Normalize a WooCommerce product to Karta format.
     */
    public static function normalize_product($product) {
        if (!$product) {
            return null;
        }

        $is_variable = $product->is_type('variable');
        $is_variation = $product->is_type('variation');

        // Handle variable products
        if ($is_variable) {
            return self::normalize_variable_product($product);
        }

        // Handle simple products and variations
        return self::normalize_simple_product($product);
    }

    /**
     * Get WooCommerce product data shared by simple and variable products:
     * canonical permalink (never constructed manually), gallery image URLs,
     * and the primary category name.
     */
    private static function get_product_common_data($product) {
        // Canonical WooCommerce product permalink (WooCommerce provides it)
        $product_url = method_exists($product, 'get_permalink') ? $product->get_permalink() : null;

        // Gallery (additional) image URLs from WooCommerce/WordPress attachments
        $images = [];
        $gallery_ids = method_exists($product, 'get_gallery_image_ids') ? $product->get_gallery_image_ids() : [];
        if (!empty($gallery_ids) && is_array($gallery_ids)) {
            foreach ($gallery_ids as $gallery_id) {
                $gallery_url = wp_get_attachment_url($gallery_id);
                if ($gallery_url) {
                    $images[] = $gallery_url;
                }
            }
        }

        // Primary category name
        $category = null;
        $terms = wp_get_post_terms($product->get_id(), 'product_cat');
        if (!empty($terms) && !is_wp_error($terms)) {
            $category = $terms[0]->name;
        }

        return [
            'productUrl' => $product_url ?: null,
            'images' => $images,
            'category' => $category,
        ];
    }

    /**
     * Normalize a simple product.
     */
    private static function normalize_simple_product($product) {
        $image_id = $product->get_image_id();
        $image_url = $image_id ? wp_get_attachment_url($image_id) : null;

        // DIAGNOSTIC: Log stock data for debugging
        error_log(sprintf(
            '[KARTA STOCK DIAG] Simple product ID=%d | get_stock_quantity=%s | get_stock_status=%s | get_manage_stock=%s',
            $product->get_id(),
            var_export($product->get_stock_quantity(), true),
            $product->get_stock_status(),
            var_export($product->get_manage_stock(), true)
        ));

        // FIX: Use ?? (null coalescing) instead of ?: (Elvis) to preserve null
        // When manage_stock=false, get_stock_quantity() returns null (not 0)
        // This null must be preserved to indicate "stock not managed"
        $stockQuantity = $product->get_stock_quantity() ?? null;

        $data = [
            'externalId' => (string) $product->get_id(),
            'sku' => $product->get_sku() ?: null,
            'name' => $product->get_name(),
            'slug' => $product->get_slug(),
            'description' => $product->get_description() ?: null,
            'shortDescription' => $product->get_short_description() ?: null,
            'price' => (float) $product->get_price(),
            'regularPrice' => (float) $product->get_regular_price(),
            'salePrice' => $product->get_sale_price() ? (float) $product->get_sale_price() : null,
            'stockQuantity' => $stockQuantity,
            'stockStatus' => $product->get_stock_status(),
            'manageStock' => $product->get_manage_stock(),
            'image' => $image_url,
            'type' => 'simple',
        ];

        $data = array_merge($data, self::get_product_common_data($product));

        // DIAGNOSTIC: Log the payload being sent
        error_log(sprintf(
            '[KARTA STOCK DIAG] Payload for product ID=%d: stockQuantity=%s, stockStatus=%s, manageStock=%s',
            $product->get_id(),
            var_export($data['stockQuantity'], true),
            $data['stockStatus'],
            var_export($data['manageStock'], true)
        ));

        return $data;
    }

    /**
     * Normalize a variable product with its variations.
     */
    private static function normalize_variable_product($product) {
        $image_id = $product->get_image_id();
        $image_url = $image_id ? wp_get_attachment_url($image_id) : null;

        $variations = [];
        $variation_ids = $product->get_children();

        foreach ($variation_ids as $variation_id) {
            $variation = wc_get_product($variation_id);
            if (!$variation) {
                continue;
            }

            $variation_image_id = $variation->get_image_id();
            $variation_image_url = $variation_image_id ? wp_get_attachment_url($variation_image_id) : null;

            // Extract attributes
            $attributes = [];
            $variation_attributes = $variation->get_attributes();
            foreach ($variation_attributes as $key => $value) {
                if ($value) {
                    $attributes[$key] = $value;
                }
            }

            // DIAGNOSTIC: Log variation stock data
            error_log(sprintf(
                '[KARTA STOCK DIAG] Variation ID=%d | get_stock_quantity=%s | get_stock_status=%s | get_manage_stock=%s',
                $variation_id,
                var_export($variation->get_stock_quantity(), true),
                $variation->get_stock_status(),
                var_export($variation->get_manage_stock(), true)
            ));

            // Preserve null when manage_stock is false
            $stockQuantity = $variation->get_stock_quantity();
            if ($stockQuantity === null) {
                $stockQuantity = null; // Keep null to indicate "stock not managed"
            }

            $variations[] = [
                'externalId' => (string) $variation_id,
                'sku' => $variation->get_sku() ?: null,
                'name' => $variation->get_name(),
                'price' => (float) $variation->get_price(),
                'regularPrice' => (float) $variation->get_regular_price(),
                'salePrice' => $variation->get_sale_price() ? (float) $variation->get_sale_price() : null,
                'stockQuantity' => $stockQuantity,
                'stockStatus' => $variation->get_stock_status(),
                'manageStock' => $variation->get_manage_stock(),
                'image' => $variation_image_url,
                'attributes' => $attributes,
            ];
        }

        $data = [
            'externalId' => (string) $product->get_id(),
            'sku' => $product->get_sku() ?: null,
            'name' => $product->get_name(),
            'slug' => $product->get_slug(),
            'description' => $product->get_description() ?: null,
            'shortDescription' => $product->get_short_description() ?: null,
            'price' => (float) $product->get_price(),
            'regularPrice' => (float) $product->get_regular_price(),
            'salePrice' => $product->get_sale_price() ? (float) $product->get_sale_price() : null,
            'stockQuantity' => $product->get_stock_quantity(),
            'stockStatus' => $product->get_stock_status(),
            'image' => $image_url,
            'type' => 'variable',
            'variations' => $variations,
        ];

        $data = array_merge($data, self::get_product_common_data($product));

        return $data;
    }
}
