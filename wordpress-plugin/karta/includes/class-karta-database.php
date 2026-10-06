<?php
/**
 * Karta Database Handler
 *
 * Creates and manages custom database tables for:
 * - AI conversation recordings
 * - Customer behavior tracking (product views, searches)
 *
 * Uses the WordPress server's own database (via wpdb).
 */

if (!defined('ABSPATH')) {
    exit;
}

class Karta_Database {

    private static $conversations_table;
    private static $messages_table;
    private static $behavior_table;

    public static function init() {
        global $wpdb;
        self::$conversations_table = $wpdb->prefix . 'karta_conversations';
        self::$messages_table = $wpdb->prefix . 'karta_messages';
        self::$behavior_table = $wpdb->prefix . 'karta_behavior';

        add_action('admin_init', [__CLASS__, 'maybe_create_tables']);
    }

    public static function maybe_create_tables() {
        global $wpdb;

        $charset_collate = $wpdb->get_charset_collate();

        $conversations_sql = "CREATE TABLE IF NOT EXISTS " . self::$conversations_table . " (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            conversation_id VARCHAR(64) NOT NULL,
            visitor_id VARCHAR(64) NOT NULL,
            site_token VARCHAR(64) NOT NULL,
            started_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            last_activity DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (id),
            INDEX idx_visitor (visitor_id),
            INDEX idx_conversation (conversation_id),
            INDEX idx_started (started_at)
        ) $charset_collate;";

        $messages_sql = "CREATE TABLE IF NOT EXISTS " . self::$messages_table . " (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            conversation_id VARCHAR(64) NOT NULL,
            role VARCHAR(10) NOT NULL,
            content TEXT NOT NULL,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (id),
            INDEX idx_conversation (conversation_id),
            INDEX idx_created (created_at)
        ) $charset_collate;";

        $behavior_sql = "CREATE TABLE IF NOT EXISTS " . self::$behavior_table . " (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            visitor_id VARCHAR(64) NOT NULL,
            event_type VARCHAR(20) NOT NULL,
            product_id BIGINT UNSIGNED DEFAULT NULL,
            search_query VARCHAR(255) DEFAULT NULL,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (id),
            INDEX idx_visitor (visitor_id),
            INDEX idx_event (event_type),
            INDEX idx_product (product_id),
            INDEX idx_created (created_at)
        ) $charset_collate;";

        require_once ABSPATH . 'wp-admin/includes/upgrade.php';
        dbDelta($conversations_sql);
        dbDelta($messages_sql);
        dbDelta($behavior_sql);
    }

    public static function get_conversations_table() {
        global $wpdb;
        return $wpdb->prefix . 'karta_conversations';
    }

    public static function get_messages_table() {
        global $wpdb;
        return $wpdb->prefix . 'karta_messages';
    }

    public static function get_behavior_table() {
        global $wpdb;
        return $wpdb->prefix . 'karta_behavior';
    }

    /**
     * Get recent conversations with message counts.
     */
    public static function get_recent_conversations($limit = 50) {
        global $wpdb;
        $conversations = self::get_conversations_table();
        $messages = self::get_messages_table();

        return $wpdb->get_results($wpdb->prepare(
            "SELECT c.*,
                (SELECT COUNT(*) FROM $messages m WHERE m.conversation_id = c.conversation_id) as message_count,
                (SELECT content FROM $messages m WHERE m.conversation_id = c.conversation_id ORDER BY m.created_at DESC LIMIT 1) as last_message
            FROM $conversations c
            ORDER BY c.last_activity DESC
            LIMIT %d",
            $limit
        ));
    }

    /**
     * Get messages for a conversation.
     */
    public static function get_conversation_messages($conversation_id) {
        global $wpdb;
        $messages = self::get_messages_table();

        return $wpdb->get_results($wpdb->prepare(
            "SELECT role, content, created_at
            FROM $messages
            WHERE conversation_id = %s
            ORDER BY created_at ASC",
            $conversation_id
        ));
    }

    /**
     * Get behavior stats for a visitor.
     */
    public static function get_visitor_behavior($visitor_id) {
        global $wpdb;
        $behavior = self::get_behavior_table();

        $product_views = $wpdb->get_results($wpdb->prepare(
            "SELECT product_id, COUNT(*) as view_count
            FROM $behavior
            WHERE visitor_id = %s AND event_type = 'product_view'
            GROUP BY product_id
            ORDER BY view_count DESC
            LIMIT 10",
            $visitor_id
        ));

        $searches = $wpdb->get_results($wpdb->prepare(
            "SELECT search_query, COUNT(*) as search_count
            FROM $behavior
            WHERE visitor_id = %s AND event_type = 'search'
            GROUP BY search_query
            ORDER BY search_count DESC
            LIMIT 10",
            $visitor_id
        ));

        return [
            'product_views' => $product_views,
            'searches' => $searches,
        ];
    }

    /**
     * Get top viewed products across all visitors.
     */
    public static function get_top_viewed_products($limit = 10) {
        global $wpdb;
        $behavior = self::get_behavior_table();

        return $wpdb->get_results($wpdb->prepare(
            "SELECT product_id, COUNT(*) as total_views
            FROM $behavior
            WHERE event_type = 'product_view'
            GROUP BY product_id
            ORDER BY total_views DESC
            LIMIT %d",
            $limit
        ));
    }

    /**
     * Clean old data (keep last 90 days).
     */
    public static function cleanup_old_data() {
        global $wpdb;
        $behavior = self::get_behavior_table();
        $messages = self::get_messages_table();
        $conversations = self::get_conversations_table();

        $wpdb->query("DELETE FROM $behavior WHERE created_at < DATE_SUB(NOW(), INTERVAL 90 DAY)");
        $wpdb->query("DELETE FROM $messages WHERE created_at < DATE_SUB(NOW(), INTERVAL 90 DAY)");
        $wpdb->query("DELETE FROM $conversations WHERE last_activity < DATE_SUB(NOW(), INTERVAL 90 DAY)");
    }
}
