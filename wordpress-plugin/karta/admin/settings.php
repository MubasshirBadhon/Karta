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

        <h2>AI Appearance</h2>
        <table class="form-table">
            <tr>
                <th><label for="karta_ai_name">AI Name</label></th>
                <td>
                    <input type="text" id="karta_ai_name" name="karta_ai_name"
                           value="<?php echo esc_attr($ai_name); ?>"
                           class="regular-text">
                    <p class="description">The name shown in the chat widget header.</p>
                </td>
            </tr>
            <tr>
                <th><label for="karta_ai_color">AI Color</label></th>
                <td>
                    <input type="color" id="karta_ai_color" name="karta_ai_color"
                           value="<?php echo esc_attr($ai_color); ?>">
                    <p class="description">Primary color for the chat widget (header, buttons, links).</p>
                </td>
            </tr>
            <tr>
                <th><label for="karta_currency">Currency Code</label></th>
                <td>
                    <input type="text" id="karta_currency" name="karta_currency"
                           value="<?php echo esc_attr($currency); ?>"
                           class="small-text" placeholder="USD">
                    <p class="description">Currency code (e.g. USD, BDT, EUR).</p>
                </td>
            </tr>
            <tr>
                <th><label for="karta_currency_symbol">Currency Symbol</label></th>
                <td>
                    <input type="text" id="karta_currency_symbol" name="karta_currency_symbol"
                           value="<?php echo esc_attr($currency_symbol); ?>"
                           class="small-text" placeholder="$">
                    <p class="description">Currency symbol shown in prices (e.g. $, ৳, €).</p>
                </td>
            </tr>
        </table>

        <h2>Priority Products</h2>
        <table class="form-table">
            <tr>
                <th><label for="karta_priority_products">Priority Product IDs</label></th>
                <td>
                    <input type="text" id="karta_priority_products" name="karta_priority_products"
                           value="<?php echo esc_attr($priority_products); ?>"
                           class="regular-text">
                    <p class="description">Comma-separated WooCommerce product IDs to prioritize in AI recommendations. Draft/out-of-stock products are automatically hidden.</p>
                </td>
            </tr>
        </table>

        <p>
            <?php submit_button('Save Changes', 'primary', 'submit', true); ?>
        </p>

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
