<?php
/**
 * Karta Conversation Recording
 *
 * Records AI conversations in the WordPress database so the merchant
 * can review them in the plugin dashboard.
 *
 * Uses the WordPress server's own database (via wpdb).
 */

if (!defined('ABSPATH')) {
    exit;
}

class Karta_Conversations {

    public static function init() {
        add_action('admin_init', [__CLASS__, 'maybe_create_tables']);
    }

    /**
     * Ensure the database tables exist.
     */
    public static function maybe_create_tables() {
        Karta_Database::maybe_create_tables();
    }

    /**
     * Record a message in a conversation.
     */
    public static function record_message($conversation_id, $role, $content) {
        global $wpdb;

        if (empty($conversation_id)) {
            return;
        }

        $messages_table = Karta_Database::get_messages_table();
        $conversations_table = Karta_Database::get_conversations_table();

        // Insert the message
        $wpdb->insert($messages_table, [
            'conversation_id' => $conversation_id,
            'role' => $role,
            'content' => $content,
            'created_at' => current_time('mysql'),
        ]);

        // Update or create the conversation record
        $existing = $wpdb->get_row($wpdb->prepare(
            "SELECT id FROM $conversations_table WHERE conversation_id = %s",
            $conversation_id
        ));

        if ($existing) {
            $wpdb->update(
                $conversations_table,
                ['last_activity' => current_time('mysql')],
                ['conversation_id' => $conversation_id]
            );
        } else {
            $wpdb->insert($conversations_table, [
                'conversation_id' => $conversation_id,
                'visitor_id' => Karta_Tracking::get_visitor_id(),
                'site_token' => Karta_Settings::get_connection_id(),
                'started_at' => current_time('mysql'),
                'last_activity' => current_time('mysql'),
            ]);
        }
    }

    /**
     * Get recent conversations for the dashboard.
     */
    public static function get_recent_conversations($limit = 50) {
        return Karta_Database::get_recent_conversations($limit);
    }

    /**
     * Get messages for a specific conversation.
     */
    public static function get_conversation_messages($conversation_id) {
        return Karta_Database::get_conversation_messages($conversation_id);
    }

    /**
     * Get top viewed products across all visitors.
     */
    public static function get_top_viewed_products($limit = 10) {
        return Karta_Database::get_top_viewed_products($limit);
    }
}
