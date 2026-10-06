=== Karta ===
Contributors: karta
Tags: woocommerce, ai, commerce, chatbot
Requires at least: 6.0
Tested up to: 6.7
Requires PHP: 7.4
Stable tag: 0.3.0
License: GPLv2 or later
License URI: https://www.gnu.org/licenses/gpl-2.0.html

Connect your WooCommerce store to Karta AI commerce platform.

== Description ==

Karta is an AI commerce platform for WooCommerce merchants. This plugin connects your WooCommerce store to Karta Cloud, enabling AI-powered product search, recommendations, and customer support.

== Installation ==

1. Upload the plugin files to `/wp-content/plugins/karta`
2. Activate the plugin through the Plugins menu in WordPress
3. Go to Settings → Karta
4. Enter your Karta API URL, Connection ID, and Secret
5. Click Connect

== Frequently Asked Questions ==

= Does this plugin contain AI logic? =

No. This is a thin connector. All AI processing happens on Karta Cloud.

= Is my data secure? =

Yes. The plugin uses HMAC-SHA256 signed requests to communicate with Karta Cloud.

== Changelog ==

= 0.3.0 =
* Configurable AI name, color, and currency symbol
* Customer behavior tracking (product views, search queries)
* AI conversation recording in WordPress database
* Priority product selection from dashboard
* Fixed mobile layout (launcher no longer covers send button)
* Fixed add-to-cart by command/confirmation

= 0.2.0 =
* Auto add-to-cart on purchase confirmation (no manual button)
* Plugin update notification with GitHub zip download
* Removed manual "Add to Cart" button from chat widget

= 0.1.0 =
* Initial release
* WooCommerce product sync
* Connection management
