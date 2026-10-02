/**
 * Karta AI — Floating Shopping Assistant Widget
 *
 * Vanilla JavaScript (no framework bundle). Builds a subtle floating
 * launcher and a compact chat panel dynamically — every element is
 * namespaced under #karta-chat-root so the merchant theme is untouched.
 *
 * Talks to the production Karta API (/api/chat). The public siteToken
 * (a revocable widget identifier, NOT a secret) resolves the store/tenant
 * server-side. No credentials, connection secrets, or tenant IDs here.
 *
 * Product recommendations are rendered as compact cards from the
 * structured API response (imageUrl, productUrl, price, availability)
 * using DOM APIs/textContent — never innerHTML — so AI/JSON content can
 * never inject markup. "View Product" opens the exact WooCommerce
 * product URL.
 *
 * Add-to-cart: the API returns a cartAction only after the customer's
 * explicit confirmation. The widget then performs the add against the
 * merchant's same-origin WooCommerce cart bridge (karta/v1/cart/add,
 * session-aware, nonce-protected) so the item lands in the CUSTOMER'S
 * cart. WooCommerce owns cart/checkout/tax/shipping/payment.
 *
 * Configuration (wp_localize_script): window.kartaWidget =
 * { apiUrl, endpoint, siteToken, cartNonce, cartEndpoint }.
 */
(function () {
  "use strict";

  var cfg = window.kartaWidget || {};

  // Without a configured API URL or site token the widget never renders.
  // (The plugin already gates this server-side; this is a defensive guard.)
  if (!cfg.apiUrl || !cfg.siteToken) {
    return;
  }

  var API_URL = String(cfg.apiUrl).replace(/\/+$/, "") + (cfg.endpoint || "/api/chat");
  var SITE_TOKEN = String(cfg.siteToken);
  var CART_NONCE = String(cfg.cartNonce || "");
  var CART_ENDPOINT = String(cfg.cartEndpoint || "");

  var WELCOME_MESSAGE =
    "Hi! I'm Karta, your AI shopping assistant. What are you looking for today?";

  var SESSION_KEY = "karta_conversation_id";
  var VISITOR_KEY = "karta_visitor_id";

  var isOpen = false;
  var isPending = false;
  var conversationId = readConversationId();
  var visitorId = readVisitorId();

  var root, launcher, popup, messagesEl, inputEl, sendBtn;

  // ─── First-party visitor identity (survives navigation) ──────

  function readVisitorId() {
    try {
      var existing = window.localStorage.getItem(VISITOR_KEY);
      if (existing) return existing;
    } catch (e) {
      /* storage unavailable — in-memory fallback */
    }
    // Cryptographically random first-party visitor ID (never an IP address)
    var id = "kvid_";
    try {
      var bytes = new Uint8Array(16);
      (window.crypto || window.msCrypto).getRandomValues(bytes);
      for (var i = 0; i < bytes.length; i++) {
        id += bytes[i].toString(16).padStart(2, "0");
      }
    } catch (e) {
      // Fallback: Math.random-based (still random, still first-party)
      for (var j = 0; j < 32; j++) {
        id += Math.floor(Math.random() * 16).toString(16);
      }
    }
    try {
      window.localStorage.setItem(VISITOR_KEY, id);
    } catch (e2) {
      /* in-memory only */
    }
    return id;
  }

  // ─── Session-scoped conversation persistence ─────────────────

  function readConversationId() {
    try {
      return window.sessionStorage.getItem(SESSION_KEY) || "";
    } catch (e) {
      return "";
    }
  }

  function saveConversationId(id) {
    conversationId = id || "";
    try {
      if (conversationId) {
        window.sessionStorage.setItem(SESSION_KEY, conversationId);
      } else {
        window.sessionStorage.removeItem(SESSION_KEY);
      }
    } catch (e) {
      /* storage unavailable (private mode) — in-memory value still works */
    }
  }

  // ─── DOM helpers (textContent only — never innerHTML) ────────

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function money(value) {
    return "\u09F3" + Number(value || 0).toLocaleString("en-IN");
  }

  // ─── Build widget markup ─────────────────────────────────────

  function build() {
    root = el("div");
    root.id = "karta-chat-root";

    // Launcher — small, subtle, badge only
    launcher = el("button", "karta-launcher");
    launcher.setAttribute("type", "button");
    launcher.setAttribute("aria-label", "Karta AI shopping assistant");
    launcher.setAttribute("aria-expanded", "false");
    launcher.appendChild(el("span", "karta-launcher-badge", "K"));
    launcher.addEventListener("click", toggle);

    // Popup — compact panel
    popup = el("div", "karta-popup");
    popup.setAttribute("role", "dialog");
    popup.setAttribute("aria-label", "Karta AI shopping assistant");

    // Header
    var header = el("div", "karta-header");
    header.appendChild(el("span", "karta-header-badge", "K"));
    var headerTitle = el("div", "karta-header-title");
    headerTitle.appendChild(el("p", "karta-header-name", "Karta AI"));
    headerTitle.appendChild(el("p", "karta-header-subtitle", "Shopping Assistant"));
    header.appendChild(headerTitle);
    var clearBtn = el("button", "karta-clear", "Clear");
    clearBtn.setAttribute("type", "button");
    clearBtn.setAttribute("aria-label", "Start a new conversation");
    clearBtn.title = "Start a new conversation";
    clearBtn.addEventListener("click", function () {
      // Reset the local view and start a NEW conversation (the previous
      // history is preserved for merchant analytics, not deleted)
      while (messagesEl.firstChild) {
        messagesEl.removeChild(messagesEl.firstChild);
      }
      addMessage("bot", WELCOME_MESSAGE);
      conversationId = "";
      saveConversationId("");
      clearConversation();
    });
    header.appendChild(clearBtn);
    var closeBtn = el("button", "karta-close", "\u00D7");
    closeBtn.setAttribute("type", "button");
    closeBtn.setAttribute("aria-label", "Close Karta AI");
    closeBtn.addEventListener("click", toggle);
    header.appendChild(closeBtn);

    // Messages
    messagesEl = el("div", "karta-messages");
    messagesEl.setAttribute("role", "log");
    messagesEl.setAttribute("aria-live", "polite");

    // Input area
    var footer = el("div", "karta-footer");
    var inputRow = el("div", "karta-input-row");
    inputEl = el("input", "karta-input");
    inputEl.type = "text";
    inputEl.placeholder = "Ask about products, prices, availability...";
    inputEl.setAttribute("aria-label", "Type your message");
    inputEl.addEventListener("keydown", function (e) {
      if (e.key === "Enter") {
        e.preventDefault();
        sendMessage();
      }
    });
    sendBtn = el("button", "karta-send", "Send");
    sendBtn.setAttribute("type", "button");
    sendBtn.addEventListener("click", sendMessage);
    inputRow.appendChild(inputEl);
    inputRow.appendChild(sendBtn);
    footer.appendChild(inputRow);
    footer.appendChild(el("p", "karta-powered", "Powered by Karta AI"));

    popup.appendChild(header);
    popup.appendChild(messagesEl);
    popup.appendChild(footer);

    root.appendChild(popup);
    root.appendChild(launcher);
    document.body.appendChild(root);

    // Welcome message (rendered safely as text)
    addMessage("bot", WELCOME_MESSAGE);

    // Restore the persisted conversation (survives page navigation):
    // the visitor's server-side conversation + messages + a proactive
    // suggestion are recovered from the visitor ID.
    restoreConversation();

    // Escape closes the popup
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && isOpen) {
        toggle();
      }
    });
  }

  // ─── Conversation restore (server-side persistence) ──────────

  function restoreConversation() {
    if (!API_URL || !visitorId) return;

    var base = API_URL.replace(/\/api\/chat.*$/, "");
    fetch(base + "/api/chat/conversation?visitorId=" + encodeURIComponent(visitorId) + "&siteToken=" + encodeURIComponent(SITE_TOKEN))
      .then(function (response) {
        return response.json().catch(function () { return null; });
      })
      .then(function (data) {
        if (!data || !data.success) return;

        if (data.conversationId) {
          saveConversationId(data.conversationId);
        }

        // Restore the previous messages (skip the welcome message we
        // already rendered)
        if (data.messages && data.messages.length) {
          while (messagesEl.firstChild) {
            messagesEl.removeChild(messagesEl.firstChild);
          }
          for (var i = 0; i < data.messages.length; i++) {
            var m = data.messages[i];
            addMessage(m.role === "bot" ? "bot" : "user", m.content || "");
          }
          if (isOpen) scrollToEnd();
        }

        // Proactive suggestion (deterministic, optional, dismissible —
        // a normal message, never an intrusive popup)
        if (data.suggestion && data.suggestion.message) {
          addMessage("bot", data.suggestion.message);
          if (data.suggestion.product) {
            addProductCards([data.suggestion.product]);
          }
        }
      })
      .catch(function () {
        /* restore is best-effort — the widget works without it */
      });
  }

  // ─── Clear conversation (new conversation, history preserved) ─

  function clearConversation() {
    var base = API_URL.replace(/\/api\/chat.*$/, "");
    addMessage("bot", "Starting a fresh conversation...");

    fetch(base + "/api/chat/conversation", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ visitorId: visitorId, siteToken: SITE_TOKEN }),
    })
      .then(function (response) {
        return response.json().catch(function () { return null; });
      })
      .then(function (data) {
        if (data && data.success && data.conversationId) {
          saveConversationId(data.conversationId);
        }
      })
      .catch(function () {
        /* best-effort */
      });
  }

  // ─── Open / close ────────────────────────────────────────────

  function toggle() {
    isOpen = !isOpen;
    popup.classList.toggle("karta-open", isOpen);
    launcher.setAttribute("aria-expanded", isOpen ? "true" : "false");
    launcher.setAttribute("aria-label", isOpen ? "Close Karta AI" : "Karta AI shopping assistant");
    if (isOpen) {
      scrollToEnd();
      inputEl.focus();
    }
  }

  // ─── Messages ────────────────────────────────────────────────

  /**
   * Render assistant text safely: textContent only, with minimal markdown
   * support (**bold**). Table/pipe lines are stripped defensively (the
   * server already sanitizes them). Never innerHTML — AI output can never
   * inject markup.
   */
  function addMessage(role, text, isError) {
    var row = el("div", "karta-msg-row karta-" + role);
    var bubble = el("div", "karta-msg" + (isError ? " karta-error" : ""));
    appendFormattedText(bubble, String(text || ""));
    row.appendChild(bubble);
    messagesEl.appendChild(row);
    scrollToEnd();
  }

  function appendFormattedText(container, text) {
    var lines = text.split("\n").filter(function (line) {
      return line.trim() !== "" && !/^\s*\|/.test(line);
    });
    var joined = lines.join("\n");
    // Split on **bold** markers; odd segments become <strong> nodes.
    var parts = joined.split("**");
    for (var i = 0; i < parts.length; i++) {
      if (parts[i] === "") continue;
      if (i % 2 === 1) {
        container.appendChild(el("strong", null, parts[i]));
      } else {
        container.appendChild(document.createTextNode(parts[i]));
      }
      if (i < parts.length - 1) {
        // preserve line breaks inside text segments
      }
    }
  }

  function showTyping() {
    var row = el("div", "karta-msg-row karta-bot");
    row.setAttribute("data-karta-typing", "1");
    var typing = el("div", "karta-typing");
    typing.appendChild(el("span", null, "Thinking..."));
    var dots = el("span", "karta-dots");
    dots.appendChild(el("span"));
    dots.appendChild(el("span"));
    dots.appendChild(el("span"));
    typing.appendChild(dots);
    row.appendChild(typing);
    messagesEl.appendChild(row);
    scrollToEnd();
  }

  function removeTyping() {
    var typingRow = messagesEl.querySelector('[data-karta-typing="1"]');
    if (typingRow) {
      typingRow.parentNode.removeChild(typingRow);
    }
  }

  function scrollToEnd() {
    if (messagesEl) {
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }
  }

  // ─── Product cards (structured API data, safe DOM rendering) ─

  function addProductCards(products) {
    if (!products || !products.length) return;

    for (var i = 0; i < products.length; i++) {
      var p = products[i];
      var row = el("div", "karta-msg-row karta-bot");
      var card = el("div", "karta-card");

      // Product image — real URL from the API, never invented;
      // neutral placeholder when the product has no image.
      if (p.imageUrl) {
        var img = el("img", "karta-card-img");
        img.src = p.imageUrl;
        img.alt = p.name || "Product image";
        img.loading = "lazy";
        img.referrerPolicy = "no-referrer";
        img.onerror = (function (imageNode, placeholderNode) {
          return function () {
            // Never display a broken image — swap in the placeholder
            if (imageNode.parentNode) {
              imageNode.parentNode.replaceChild(placeholderNode, imageNode);
            }
          };
        })(img, makePlaceholder());
        card.appendChild(img);
      } else {
        card.appendChild(makePlaceholder());
      }

      var body = el("div", "karta-card-body");

      // Name
      body.appendChild(el("p", "karta-card-name", p.name || "Product"));

      // Price (+ compare-at price when discounted)
      var priceRow = el("div", "karta-card-price-row");
      priceRow.appendChild(el("span", "karta-card-price", money(p.price)));
      if (p.compareAtPrice && Number(p.compareAtPrice) > Number(p.price)) {
        priceRow.appendChild(el("span", "karta-card-old-price", money(p.compareAtPrice)));
      }
      body.appendChild(priceRow);

      // Availability — from the structured API data. stock=null means
      // not managed → "Available"; explicit out-of-stock → "Out of stock".
      var stockClass = p.available ? "karta-stock-in" : "karta-stock-out";
      body.appendChild(el("p", "karta-card-stock " + stockClass, p.availability || (p.available ? "Available" : "Out of stock")));

      // Optional variant information
      if (p.variants && p.variants.length) {
        body.appendChild(el("p", "karta-card-variants", p.variants.join(" · ")));
      }

      // Actions: View Product (exact WooCommerce URL) + Add to cart
      var actions = el("div", "karta-card-actions");

      if (p.productUrl) {
        var link = el("a", "karta-card-link", "View Product");
        link.href = p.productUrl;
        link.target = "_blank";
        link.rel = "noopener";
        actions.appendChild(link);
      }

      if (p.available && CART_ENDPOINT && CART_NONCE) {
        var addBtn = el("button", "karta-card-add", "Add to Cart");
        addBtn.setAttribute("type", "button");
        addBtn.setAttribute("data-karta-product-id", p.id);
        addBtn.addEventListener("click", function (event) {
          requestAddToCart(event.currentTarget.getAttribute("data-karta-product-id"));
        });
        actions.appendChild(addBtn);
      }

      if (actions.childNodes.length) {
        body.appendChild(actions);
      }

      card.appendChild(body);
      row.appendChild(card);
      messagesEl.appendChild(row);
    }

    scrollToEnd();
  }

  function makePlaceholder() {
    var placeholder = el("div", "karta-card-img karta-card-img-empty");
    placeholder.textContent = "No image";
    return placeholder;
  }

  // ─── Add to cart (explicit confirmation already given by the API) ──

  function requestAddToCart(kartaProductId) {
    // Idempotency: a double click / browser retry must not send duplicate
    // requests — the pending guard covers both sendMessage and card adds.
    if (isPending || !kartaProductId) return;

    isPending = true;
    inputEl.disabled = true;
    sendBtn.disabled = true;

    // Resolve the WooCommerce IDs from the Karta product ID via the
    // chat API confirmation flow: send an add-to-cart message so the
    // deterministic layer resolves the exact product/variation and
    // returns a cartAction after confirmation.
    var text = "add this to cart";
    addMessage("user", text);
    showTyping();
    chatRequest({ message: text, targetProductId: kartaProductId });
  }

  // ─── Error states (distinct, friendly, retry allowed) ────────

  function friendlyError(status) {
    switch (status) {
      case 400:
        return "Invalid request. Please try rephrasing your message.";
      case 401:
        return "This store's Karta AI connection needs to be configured.";
      case 403:
        return "This website is not authorized to use Karta AI for this store.";
      case 404:
        return "Karta AI service is not available for this store.";
      case 429:
        return "Karta AI is busy right now. Please try again in a moment.";
      default:
        return "Karta AI is temporarily unavailable. Please try again.";
    }
  }

  // ─── API call (existing Karta /api/chat contract) ────────────

  function sendMessage() {
    var text = (inputEl.value || "").trim();

    // No empty sends, no duplicate sends while a request is pending.
    if (!text || isPending) {
      return;
    }

    isPending = true;
    inputEl.value = "";
    inputEl.disabled = true;
    sendBtn.disabled = true;

    addMessage("user", text);
    showTyping();
    chatRequest({ message: text });
  }

  function chatRequest(payload) {
    // Request body: { message, conversationId?, siteToken, visitorId?, targetProductId? }
    // — the public site token + the first-party visitor ID resolve the
    // visitor's own persistent conversation server-side.
    var body = { message: payload.message, siteToken: SITE_TOKEN, visitorId: visitorId };
    if (conversationId) {
      body.conversationId = conversationId;
    }
    if (payload.targetProductId) {
      body.targetProductId = payload.targetProductId;
    }

    fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
      .then(function (response) {
        return response
          .json()
          .catch(function () {
            return null;
          })
          .then(function (data) {
            return { ok: response.ok, status: response.status, data: data };
          });
      })
      .then(function (result) {
        removeTyping();
        handleChatResponse(result);
      })
      .catch(function () {
        // Network/CORS failure — the browser blocked the request
        removeTyping();
        addMessage(
          "bot",
          "Karta AI could not connect to the store service. Please check your connection and try again.",
          true
        );
      })
      .then(function () {
        // Always re-enable input — retry is allowed after errors.
        isPending = false;
        inputEl.disabled = false;
        sendBtn.disabled = false;
        inputEl.focus();
      });
  }

  function handleChatResponse(result) {
    var data = result.data;

    if (result.ok && data && data.success) {
      // Persist conversationId for the current browser session so
      // multi-turn conversations work.
      if (data.conversationId) {
        saveConversationId(data.conversationId);
      }

      var text = data.message || data.response || "";
      var hasProducts = data.products && data.products.length > 0;

      if (data.aiSuccess === false) {
        addMessage("bot", text || friendlyError(500), true);
        return;
      }

      if (text) {
        addMessage("bot", text);
      }

      if (hasProducts) {
        addProductCards(data.products);
      }

      // Proactive recommendation (deterministic, transparent, optional)
      if (data.suggestion && data.suggestion.message) {
        addMessage("bot", data.suggestion.message);
        if (data.suggestion.product) {
          addProductCards([data.suggestion.product]);
        }
      }

      // Confirmed cart action → perform the add against the merchant's
      // own WooCommerce cart (customer's session, same origin).
      if (data.cartAction && data.cartAction.type === "addToCart") {
        performAddToCart(data.cartAction);
      }

      if (!text && !hasProducts) {
        addMessage("bot", "Karta AI returned an empty response. Please try again.", true);
      }
    } else {
      // HTTP errors — distinct messages per status code
      addMessage("bot", friendlyError(result.status), true);
    }
  }

  function performAddToCart(action) {
    if (!CART_ENDPOINT || !CART_NONCE) {
      addMessage("bot", "Cart is not available on this store.", true);
      return;
    }

    fetch(CART_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Karta-Nonce": CART_NONCE,
      },
      body: JSON.stringify({
        productId: action.productId,
        variationId: action.variationId || 0,
        quantity: action.quantity || 1,
        inventoryMode: action.inventoryMode || "unlimited",
      }),
    })
      .then(function (response) {
        return response
          .json()
          .catch(function () {
            return null;
          })
          .then(function (data) {
            return { ok: response.ok, data: data };
          });
      })
      .then(function (result) {
        if (result.ok && result.data && result.data.success) {
          addCartSummary(action, result.data);
        } else {
          // Surface the actual safe customer-facing reason — never claim success
          var message =
            result.data && result.data.message
              ? result.data.message
              : "Could not add the product to the cart. Please try again.";
          addMessage("bot", message, true);
        }
      })
      .catch(function () {
        addMessage("bot", "Could not reach the cart. Please try again.", true);
      });
  }

  /**
   * Compact cart summary: the added product, quantity, cart total,
   * View Cart + Checkout (the actual WooCommerce pages).
   */
  function addCartSummary(action, result) {
    var cart = result.cart || {};
    var item = result.item || {};

    var text =
      (item.name || action.productName || "Product") +
      " \u00D7 " +
      (item.quantity || action.quantity || 1) +
      (cart.total !== undefined
        ? " — cart total " + money(cart.total)
        : "");
    if (cart.count !== undefined) {
      text += " (" + cart.count + " items)";
    }
    addMessage("bot", text);

    var row = el("div", "karta-msg-row karta-bot");
    var panel = el("div", "karta-cart-panel");

    if (result.cartUrl) {
      var cartLink = el("a", "karta-cart-link karta-cart-view", "View Cart");
      cartLink.href = result.cartUrl;
      panel.appendChild(cartLink);
    }
    if (result.checkoutUrl) {
      var checkoutLink = el("a", "karta-cart-link karta-cart-checkout", "Checkout");
      checkoutLink.href = result.checkoutUrl;
      panel.appendChild(checkoutLink);
    }

    if (panel.childNodes.length) {
      row.appendChild(panel);
      messagesEl.appendChild(row);
      scrollToEnd();
    }
  }

  // ─── Boot ────────────────────────────────────────────────────

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", build);
  } else {
    build();
  }
})();
