<?php
/**
 * Karta Settings Page Template
 */
?>
<div class="wrap karta-settings">
    <h1>Karta</h1>

    <?php if ($is_connected) : ?>
        <div class="karta-connection-status connected">
            <span class="karta-status-dot"></span>
            <strong>Connected</strong>
        </div>

        <table class="form-table">
            <tr>
                <th>Store URL</th>
                <td><?php echo esc_html(home_url()); ?></td>
            </tr>
            <tr>
                <th>Connection ID</th>
                <td><code><?php echo esc_html($connection_id); ?></code></td>
            </tr>
            <tr>
                <th>Last Sync</th>
                <td><?php echo esc_html(get_option('karta_last_sync_at', 'Never')); ?></td>
            </tr>
            <tr>
                <th>Products</th>
                <td>
                    <?php
                    $product_count = count(wc_get_products(['limit' => -1, 'status' => 'publish']));
                    echo esc_html($product_count);
                    ?>
                </td>
            </tr>
        </table>

        <p>
            <button type="button" class="button button-primary" id="karta-sync-products">
                Sync Products
            </button>
            <button type="button" class="button" id="karta-test-connection">
                Test Connection
            </button>
            <button type="button" class="button" id="karta-diagnostics">
                Diagnostics
            </button>
            <button type="button" class="button button-link-delete" id="karta-disconnect">
                Disconnect
            </button>
        </p>

        <div id="karta-sync-results" class="karta-results" style="display:none;"></div>
        <div id="karta-diagnostics-results" class="karta-results" style="display:none;"></div>

    <?php else : ?>
        <div class="karta-connection-status disconnected">
            <span class="karta-status-dot"></span>
            <strong>Not Connected</strong>
        </div>

        <p>Connect your WooCommerce store to Karta AI commerce platform.</p>

        <form method="post" action="options.php">
            <?php settings_fields('karta_settings'); ?>

            <table class="form-table">
                <tr>
                    <th><label for="karta_api_url">Karta API URL</label></th>
                    <td>
                        <input type="url" id="karta_api_url" name="karta_api_url"
                               value="<?php echo esc_attr($api_url); ?>"
                               class="regular-text" placeholder="https://your-karta-server.com">
                    </td>
                </tr>
                <tr>
                    <th><label for="karta_connection_id">Connection ID</label></th>
                    <td>
                        <input type="text" id="karta_connection_id" name="karta_connection_id"
                               value="<?php echo esc_attr($connection_id); ?>"
                               class="regular-text">
                    </td>
                </tr>
                <tr>
                    <th><label for="karta_secret">Connection Secret</label></th>
                    <td>
                        <input type="password" id="karta_secret" name="karta_secret"
                               value="<?php echo esc_attr($secret); ?>"
                               class="regular-text">
                    </td>
                </tr>
            </table>

            <?php submit_button('Connect', 'primary', 'submit', true); ?>
        </form>

        <p>
            <button type="button" class="button" id="karta-test-connection-not-configured">
                Test Connection
            </button>
        </p>
    <?php endif; ?>
</div>
