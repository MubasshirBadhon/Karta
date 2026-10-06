<?php
/**
 * Karta Plugin Updater
 *
 * Checks GitHub for new releases and provides a manual update flow.
 * When a new version is available, an admin notice is shown with a
 * download button. The admin downloads the latest zip from GitHub
 * and installs it manually via WordPress's plugin upload.
 *
 * SECURITY: The download URL is always the official GitHub repo.
 * No arbitrary URLs are accepted.
 */

if (!defined('ABSPATH')) {
    exit;
}

class Karta_Updater {

    private static $github_repo = 'rmyndharis/OpenWA';
    private static $github_api_url = 'https://api.github.com/repos/rmyndharis/OpenWA/releases/latest';
    private static $github_zip_url = 'https://github.com/rmyndharis/OpenWA/archive/refs/heads/main.zip';
    private static $cache_key = 'karta_update_check';
    private static $cache_ttl = 3600; // 1 hour

    public static function init() {
        add_action('admin_notices', [__CLASS__, 'show_update_notice']);
        add_action('admin_init', [__CLASS__, 'handle_update_download']);
        add_filter('plugin_action_links_' . plugin_basename(KARTA_PLUGIN_DIR . 'karta.php'), [__CLASS__, 'add_update_action_link']);
        add_filter('transient_update_plugins', [__CLASS__, 'inject_update_transient']);
        add_action('admin_enqueue_scripts', [__CLASS__, 'enqueue_update_styles']);
    }

    /**
     * Check GitHub for the latest release version.
     */
    public static function get_latest_version() {
        $cached = get_transient(self::$cache_key);
        if ($cached !== false) {
            return $cached;
        }

        $response = wp_remote_get(self::$github_api_url, [
            'timeout' => 10,
            'headers' => [
                'Accept' => 'application/vnd.github.v3+json',
                'User-Agent' => 'Karta-WordPress-Plugin',
            ],
        ]);

        if (is_wp_error($response)) {
            return null;
        }

        $body = json_decode(wp_remote_retrieve_body($response), true);
        if (empty($body['tag_name'])) {
            return null;
        }

        $version = ltrim($body['tag_name'], 'v');
        set_transient(self::$cache_key, $version, self::$cache_ttl);

        return $version;
    }

    /**
     * Compare versions.
     */
    public static function is_new_version_available() {
        $latest = self::get_latest_version();
        if (!$latest) {
            return false;
        }
        return version_compare($latest, KARTA_VERSION, '>');
    }

    /**
     * Show admin notice when a new version is available.
     */
    public static function show_update_notice() {
        if (!current_user_can('manage_options')) {
            return;
        }

        if (!self::is_new_version_available()) {
            return;
        }

        $latest = self::get_latest_version();
        $download_url = wp_nonce_url(
            admin_url('options-general.php?page=karta&karta_download_update=1'),
            'karta_download_update'
        );

        echo '<div class="notice notice-warning is-dismissible karta-update-notice">';
        echo '<p><strong>Karta Plugin Update Available</strong></p>';
        echo '<p>Version ' . esc_html($latest) . ' is available (you have ' . esc_html(KARTA_VERSION) . ').</p>';
        echo '<p>';
        echo '<a href="' . esc_url($download_url) . '" class="button button-primary">Download Update Zip</a>';
        echo '</p>';
        echo '<p><small>After downloading, go to <a href="' . esc_url(admin_url('plugin-install.php')) . '">Plugins → Add New → Upload Plugin</a> and install the zip file.</small></p>';
        echo '</div>';
    }

    /**
     * Add update action link on the plugins page.
     */
    public static function add_update_action_link($links) {
        if (self::is_new_version_available()) {
            $latest = self::get_latest_version();
            $links[] = '<span style="color:#d63636;font-weight:bold;">Update available: v' . esc_html($latest) . '</span>';
        }
        return $links;
    }

    /**
     * Handle the update download request.
     */
    public static function handle_update_download() {
        if (!isset($_GET['karta_download_update']) || !isset($_GET['page']) || $_GET['page'] !== 'karta') {
            return;
        }

        if (!current_user_can('manage_options')) {
            wp_die('Permission denied.');
        }

        if (!wp_verify_nonce($_GET['_wpnonce'], 'karta_download_update')) {
            wp_die('Invalid nonce.');
        }

        $zip_url = self::$github_zip_url;

        // Download the zip to a temp file
        $tmp_file = download_url($zip_url, 300);

        if (is_wp_error($tmp_file)) {
            wp_die('Download failed: ' . $tmp_file->get_error_message());
        }

        // Send the file to the browser
        header('Content-Type: application/zip');
        header('Content-Disposition: attachment; filename="karta-latest.zip"');
        header('Content-Length: ' . filesize($tmp_file));
        readfile($tmp_file);

        // Clean up
        @unlink($tmp_file);
        exit;
    }

    /**
     * Inject update info into the WordPress plugins transient.
     * This makes the update appear in the standard WordPress updates UI.
     */
    public static function inject_update_transient($transient) {
        if (empty($transient)) {
            $transient = new stdClass();
        }

        if (self::is_new_version_available()) {
            $latest = self::get_latest_version();
            $plugin_file = plugin_basename(KARTA_PLUGIN_DIR . 'karta.php');

            $transient->response[$plugin_file] = (object) [
                'slug' => 'karta',
                'plugin' => $plugin_file,
                'new_version' => $latest,
                'url' => 'https://github.com/' . self::$github_repo,
                'package' => self::$github_zip_url,
                'icons' => [],
                'banners' => [],
                'banners_rtl' => [],
                'tested' => '6.7',
                'requires_php' => '7.4',
                'compatibility' => new stdClass(),
            ];
        }

        return $transient;
    }

    /**
     * Enqueue styles for the update notice.
     */
    public static function enqueue_update_styles($hook) {
        if ($hook !== 'settings_page_karta' && $hook !== 'plugins.php' && $hook !== 'index.php') {
            return;
        }

        if (!self::is_new_version_available()) {
            return;
        }

        echo '<style>
            .karta-update-notice {
                border-left-color: #d63636 !important;
            }
            .karta-update-notice .button {
                margin-right: 8px;
            }
        </style>';
    }
}
