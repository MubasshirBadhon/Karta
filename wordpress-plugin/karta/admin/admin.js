/**
 * Karta Admin JavaScript
 */
jQuery(document).ready(function ($) {
    // Sync Products
    $('#karta-sync-products').on('click', function () {
        var $button = $(this);
        var $results = $('#karta-sync-results');

        $button.prop('disabled', true).text('Syncing...');
        $results.hide().removeClass('success error');

        $.ajax({
            url: kartaAjax.ajaxUrl,
            type: 'POST',
            data: {
                action: 'karta_sync_products',
                nonce: kartaAjax.nonce,
            },
            success: function (response) {
                if (response.success) {
                    $results.html(
                        '<strong>Sync Complete:</strong> ' +
                        response.data.synced + ' products synced, ' +
                        response.data.failed + ' failed.'
                    ).addClass('success').show();
                } else {
                    $results.html('<strong>Error:</strong> ' + response.data.message).addClass('error').show();
                }
            },
            error: function () {
                $results.html('<strong>Error:</strong> Request failed.').addClass('error').show();
            },
            complete: function () {
                $button.prop('disabled', false).text('Sync Products');
            },
        });
    });

    // Test Connection
    $('#karta-test-connection, #karta-test-connection-not-configured').on('click', function () {
        var $button = $(this);
        $button.prop('disabled', true).text('Testing...');

        $.ajax({
            url: kartaAjax.ajaxUrl,
            type: 'POST',
            data: {
                action: 'karta_test_connection',
                nonce: kartaAjax.nonce,
            },
            success: function (response) {
                if (response.success) {
                    alert('Connection successful!');
                } else {
                    alert('Connection failed: ' + response.data.message);
                }
            },
            error: function () {
                alert('Connection test failed.');
            },
            complete: function () {
                $button.prop('disabled', false).text('Test Connection');
            },
        });
    });

    // Disconnect
    $('#karta-disconnect').on('click', function () {
        if (!confirm('Are you sure you want to disconnect from Karta?')) {
            return;
        }

        $.ajax({
            url: kartaAjax.ajaxUrl,
            type: 'POST',
            data: {
                action: 'karta_disconnect',
                nonce: kartaAjax.nonce,
            },
            success: function () {
                window.location.reload();
            },
        });
    });
});
