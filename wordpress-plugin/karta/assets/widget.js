/**
 * Karta AI — Floating Chat Widget
 *
 * Vanilla JavaScript (no framework bundle). Builds the floating launcher
 * and chat popup dynamically so nothing is injected into the merchant's
 * markup, and every element is namespaced under #karta-chat-root.
 *
 * Talks to the existing production Karta API (/api/chat). The public
 * siteToken (a revocable widget identifier, NOT a secret) resolves the
 * store/tenant server-side. No credentials, connection secrets, or
 * tenant IDs are handled here.
 *
 * Product recommendations are rendered as structured cards from API data
 * (imageUrl, productUrl, price, availability) using DOM APIs/textContent —
 * never innerHTML — so AI/JSON content can never inject markup. The
 * "View Product" button opens the real WooCommerce product URL.
 *
 * Configuration is provided by the Karta WordPress plugin via
 * wp_localize_script as window.kartaWidget = { apiUrl, endpoint, siteToken }.
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

  var WELCOME_MESSAGE =
    "Hi! I'm Karta, your AI shopping assistant. How can I help you find something today?";

  var SESSION_KEY = "karta_conversation_id";

  var isOpen = false;
  var isPending = false;
  var conversationId = readConversationId();

  var root, launcher, popup, messagesEl, inputEl, sendBtn;

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

    // Launcher button
    launcher = el("button", "karta-launcher");
    launcher.setAttribute("type", "button");
    launcher.setAttribute("aria-label", "Open Karta AI chat");
    launcher.setAttribute("aria-expanded", "false");
    launcher.appendChild(el("span", "karta-launcher-badge", "K"));
    launcher.appendChild(el("span", "karta-launcher-label", "Karta AI"));
    launcher.addEventListener("click", toggle);

    // Popup
    popup = el("div", "karta-popup");
    popup.setAttribute("role", "dialog");
    popup.setAttribute("aria-label", "Karta AI chat");

    // Header
    var header = el("div", "karta-header");
    header.appendChild(el("span", "karta-header-badge", "K"));
    var headerTitle = el("div", "karta-header-title");
    headerTitle.appendChild(el("p", "karta-header-name", "Karta AI"));
    headerTitle.appendChild(el("p", "karta-header-subtitle", "AI Shopping Assistant"));
    header.appendChild(headerTitle);
    var closeBtn = el("button", "karta-close", "\u00D7");
    closeBtn.setAttribute("type", "button");
    closeBtn.setAttribute("aria-label", "Close Karta AI chat");
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
    footer.appendChild(el("p", "karta-powered", "Powered by Karta AI — answers based on real product data"));

    popup.appendChild(header);
    popup.appendChild(messagesEl);
    popup.appendChild(footer);

    root.appendChild(popup);
    root.appendChild(launcher);
    document.body.appendChild(root);

    // Welcome message (rendered safely as text)
    addMessage("bot", WELCOME_MESSAGE);

    // Escape closes the popup
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && isOpen) {
        toggle();
      }
    });
  }

  // ─── Open / close ────────────────────────────────────────────

  function toggle() {
    isOpen = !isOpen;
    popup.classList.toggle("karta-open", isOpen);
    launcher.setAttribute("aria-expanded", isOpen ? "true" : "false");
    launcher.setAttribute("aria-label", isOpen ? "Close Karta AI chat" : "Open Karta AI chat");
    if (isOpen) {
      scrollToEnd();
      inputEl.focus();
    }
  }

  // ─── Messages ────────────────────────────────────────────────

  function addMessage(role, text, isError) {
    var row = el("div", "karta-msg-row karta-" + role);
    var bubble = el("div", "karta-msg" + (isError ? " karta-error" : ""), text);
    row.appendChild(bubble);
    messagesEl.appendChild(row);
    scrollToEnd();
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

      // Product image — only the real URL from the API, never invented
      if (p.imageUrl) {
        var img = el("img", "karta-card-img");
        img.src = p.imageUrl;
        img.alt = p.name || "Product image";
        img.loading = "lazy";
        img.referrerPolicy = "no-referrer";
        card.appendChild(img);
      } else {
        var placeholder = el("div", "karta-card-img karta-card-img-empty");
        placeholder.textContent = "No image";
        card.appendChild(placeholder);
      }

      var body = el("div", "karta-card-body");

      // Name
      body.appendChild(el("p", "karta-card-name", p.name || "Product"));

      // Price (+ old price if on sale)
      var priceRow = el("div", "karta-card-price-row");
      priceRow.appendChild(el("span", "karta-card-price", money(p.price)));
      if (p.compareAtPrice && Number(p.compareAtPrice) > Number(p.price)) {
        priceRow.appendChild(el("span", "karta-card-old-price", money(p.compareAtPrice)));
      }
      body.appendChild(priceRow);

      // Availability — null stock means not managed/unknown, never "0"
      var stockText;
      if (!p.available) {
        stockText = "Out of stock";
      } else if (p.stockManaged && p.stock !== null && p.stock !== undefined) {
        stockText = "In stock" + (Number(p.stock) > 0 ? " (" + Number(p.stock) + ")" : "");
      } else {
        stockText = "Available";
      }
      body.appendChild(
        el("p", "karta-card-stock " + (p.available ? "karta-stock-in" : "karta-stock-out"), stockText)
      );

      // Optional variant information
      if (p.variants && p.variants.length) {
        body.appendChild(el("p", "karta-card-variants", p.variants.join(" · ")));
      }

      // "View Product" opens the real WooCommerce product URL
      if (p.productUrl) {
        var link = el("a", "karta-card-link", "View Product");
        link.href = p.productUrl;
        link.target = "_blank";
        link.rel = "noopener";
        body.appendChild(link);
      }

      card.appendChild(body);
      row.appendChild(card);
      messagesEl.appendChild(row);
    }

    scrollToEnd();
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

    // Request body: { message, conversationId?, siteToken } — the public
    // site token resolves the store/tenant server-side.
    var body = { message: text, siteToken: SITE_TOKEN };
    if (conversationId) {
      body.conversationId = conversationId;
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

        var data = result.data;

        if (result.ok && data && data.success) {
          // Persist conversationId for the current browser session
          // so multi-turn conversations work.
          if (data.conversationId) {
            saveConversationId(data.conversationId);
          }

          var text = data.response || "";
          var hasProducts = data.products && data.products.length > 0;

          // AI provider failure (server reports aiSuccess=false) or empty
          // response is shown as a distinct error state — never a network error.
          if (data.aiSuccess === false) {
            addMessage("bot", text || friendlyError(500), true);
          } else if (text) {
            addMessage("bot", text);
            if (hasProducts) {
              addProductCards(data.products);
            }
          } else if (hasProducts) {
            addProductCards(data.products);
          } else {
            addMessage("bot", "Karta AI returned an empty response. Please try again.", true);
          }
        } else {
          // HTTP errors — distinct messages per status code
          addMessage("bot", friendlyError(result.status), true);
        }
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

  // ─── Boot ────────────────────────────────────────────────────

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", build);
  } else {
    build();
  }
})();
