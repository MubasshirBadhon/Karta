/**
 * Deterministic Catalog Matcher & Shopping Intent
 *
 * Deterministic natural-language understanding for the website chat widget.
 * This module intentionally does NOT call an LLM and does NOT modify
 * carts/orders. It is the first stage of the website AI flow:
 *
 *   1. Deterministic intent + catalog/product matching (this module)
 *   2. AI for natural-language response (commerce engine) — short text only
 *
 * The LLM is never the source of truth for products, prices, stock,
 * variants, URLs, or images — all product data comes from the database
 * via these deterministic functions. Budget math is deterministic.
 *
 * Understands Bangla, Banglish, English, mixed input, and common
 * transliteration/spelling mistakes.
 *
 * Patterns reused from the reference implementation under /test
 * (test/app/api/chat/route.ts, test/lib/commerce/intent.ts).
 */

// ─── Normalization (Bangla → Banglish transliteration) ───────

export function normalizeText(value: string): string {
  return String(value || "")
    .toLowerCase()
    .replace(/[অআ]/g, "a").replace(/[ইঈ]/g, "i").replace(/[উঊ]/g, "u")
    .replace(/[ঋ]/g, "ri")
    .replace(/[এঐ]/g, "e").replace(/[ওঔ]/g, "o")
    .replace(/[ক]/g, "k").replace(/[খ]/g, "kh").replace(/[গ]/g, "g").replace(/[ঘ]/g, "gh")
    .replace(/[ঙ]/g, "ng").replace(/[চ]/g, "ch").replace(/[ছ]/g, "chh").replace(/[জ]/g, "j").replace(/[ঝ]/g, "jh")
    .replace(/[ঞ]/g, "n").replace(/[ট]/g, "t").replace(/[ঠ]/g, "th").replace(/[ড]/g, "d").replace(/[ঢ]/g, "dh")
    .replace(/[ণ]/g, "n").replace(/[ত]/g, "t").replace(/[থ]/g, "th").replace(/[দ]/g, "d").replace(/[ধ]/g, "dh")
    .replace(/[ন]/g, "n").replace(/[প]/g, "p").replace(/[ফ]/g, "f").replace(/[ব]/g, "b").replace(/[ভ]/g, "bh")
    .replace(/[ম]/g, "m").replace(/[যয]/g, "y").replace(/[র]/g, "r").replace(/[ল]/g, "l").replace(/[শষস]/g, "s")
    .replace(/[হ]/g, "h").replace(/[ং]/g, "ng").replace(/[ঃঁ]/g, "")
    .replace(/[০]/g, "0").replace(/[১]/g, "1").replace(/[২]/g, "2").replace(/[৩]/g, "3")
    .replace(/[৪]/g, "4").replace(/[৫]/g, "5").replace(/[৬]/g, "6").replace(/[৭]/g, "7")
    .replace(/[৮]/g, "8").replace(/[৯]/g, "9")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// ─── Category aliases (Bangla / Banglish / English + typos) ──

const CATEGORY_ALIASES: Record<string, string[]> = {
  watch: ["watch", "watches", "ghori", "ঘড়ি", "ঘডি", "স্মার্ট ঘড়ি", "smart watch", "smartwatch", "timepiece"],
  lipstick: ["lipstick", "lip stick", "lipstik", "lipstic", "লিপস্টিক", "লিপ কালার", "lip color", "ঠোঁটের রং", "thoter rong"],
  keyboard: ["keyboard", "key board", "kibord", "kiboard", "কিবোর্ড", "কীবোর্ড"],
  earbuds: ["earbuds", "earbud", "ear buds", "ইয়ারবাড", "ইয়ারবাড", "বাড", "buds"],
  headphone: ["headphone", "headphones", "হেডফোন", "hedphone"],
  charger: ["charger", "চার্জার", "চার্জিং", "চার্জ", "charjer"],
  bag: ["bag", "ব্যাগ", "ব্যাকপ্যাক", "backpack", "back pack", "purse", "পার্স", "wallet", "ওয়ালেট"],
  shoes: ["shoe", "shoes", "জুতা", "জুতো", "juta", "sneaker", "sneakers"],
  clothes: ["dress", "clothes", "cloth", "fashion", "জামা", "পোশাক", "কাপড়", "কাপড", "শার্ট", "প্যান্ট", "shirt", "pant", "tshirt", "t-shirt", "jeans", "জিন্স"],
  skincare: ["skincare", "skin care", "facewash", "face wash", "cleanser", "sunscreen", "সানস্ক্রিন", "ফেসওয়াশ", "ফেসওয়াশ"],
  speaker: ["speaker", "স্পিকার", "soundbox", "sound box"],
  camera: ["camera", "ক্যামেরা"],
  laptop: ["laptop", "ল্যাপটপ", "লেপটপ"],
  phone: ["phone", "mobile", "মোবাইল", "ফোন"],
  mouse: ["mouse", "মাউস"],
  monitor: ["monitor", "মনিটর"],
  bottle: ["bottle", "বোতল"],
  sunglasses: ["sunglasses", "sunglass", "চশমা"],
};

const COLOR_WORDS: Record<string, string[]> = {
  black: ["black", "kalo", "কালো", "কালা"],
  white: ["white", "sada", "সাদা", "শাদা"],
  red: ["red", "lal", "লাল"],
  blue: ["blue", "nil", "নীল", "নিল"],
  green: ["green", "sabuj", "সবুজ"],
  gold: ["gold", "golden", "sona", "সোনা", "সোনালি"],
  silver: ["silver", "rupa", "রুপো", "রুপা", "রুপালি"],
  pink: ["pink", "গোলাপি"],
  yellow: ["yellow", "holud", "হলুদ"],
  gray: ["gray", "grey", "dhushor", "ধূসর"],
  brown: ["brown", "badami", "বাদামি"],
  purple: ["purple", "beguni", "বেগুনি"],
  orange: ["orange", "komola", "কমলা"],
  cream: ["cream", "ক্রিম"],
  olive: ["olive", "জলপাই"],
  navy: ["navy", "নেভি"],
  beige: ["beige", "বেইজ"],
  lavender: ["lavender", "ল্যাভেন্ডার"],
  sage: ["sage", "বণক"],
  peach: ["pink", "গোলাপি"],
};

const SIZE_PATTERN =
  /(?:^|\s)(?:size\s*)?(xxs|xs|s|m|l|xl|xxl|2xl|3xl|small|medium|large|\d{2}(?:\.\d)?)(?!\s*(?:tk|taka|takar|টাকা|টাকার))(?:\s|$|\b)/i;

// ─── Product input shape (from Prisma, with variants) ─────────

export interface CatalogProduct {
  id: string;
  externalId: string | null;
  name: string;
  description: string | null;
  price: number;
  compareAtPrice: number | null;
  stock: number | null; // null = stock not managed, 0 = out of stock (ignored in unlimited mode)
  stockStatus: string | null; // WooCommerce: instock | outofstock | onbackorder | null
  manageStock: boolean | null; // WooCommerce manage_stock (null = unknown)
  status: string; // Karta product status: active | draft | archived
  image: string | null;
  productUrl: string | null;
  sku: string | null;
  category: string | null;
  variants: Array<{
    id: string;
    externalId?: string | null;
    name: string;
    attributes: Record<string, string>;
    price: number;
    stock: number | null;
  }>;
}

export type InventoryMode = "unlimited" | "managed";

export interface ProductCard {
  id: string;
  externalId: string | null;
  name: string;
  category: string | null;
  price: number;
  compareAtPrice: number | null;
  stock: number | null;
  stockManaged: boolean;
  available: boolean;
  availability: string;
  imageUrl: string | null;
  productUrl: string | null;
  sku: string | null;
  variants: string[];
  variantOptions: Array<{
    id: string;
    externalId: string | null;
    name: string;
    attributes: Record<string, string>;
    price: number;
    stock: number | null;
    available: boolean;
  }>;
}

// ─── Availability (exact stock semantics) ────────────────────

/**
 * Karta's own inventory policy — the availability engine.
 *
 * inventoryMode = "unlimited" (the merchant does not use WooCommerce as
 * quantity inventory control):
 *   - Stock quantity MUST NOT determine availability.
 *   - stock=0, stock=null, stock=100 → all available.
 *   - Never "out of stock" / "stock unavailable" from quantity.
 *   - The product is unavailable ONLY if Karta has it archived/draft
 *     (explicitly unavailable) or the merchant EXPLICITLY set the
 *     WooCommerce stock status to out-of-stock manually (which only
 *     happens when stock management is disabled — independent of quantity).
 *   - A quantity-derived out-of-stock status (manageStock=true) is
 *     quantity-driven and is ignored.
 *
 * inventoryMode = "managed":
 *   - WooCommerce quantity/stock status determine availability:
 *     explicit outofstock → unavailable; stock=0 → unavailable;
 *     stock=null (quantity unknown/not managed) → available; stock>0 → available.
 *
 * null is NEVER converted to 0 anywhere.
 */
export function isProductAvailable(
  product: CatalogProduct,
  inventoryMode: InventoryMode = "unlimited"
): boolean {
  // Archived/draft products are explicitly unavailable in Karta
  if (product.status !== "active") return false;

  if (inventoryMode === "unlimited") {
    // Only a MANUAL merchant-set out-of-stock status counts (this state
    // exists only when stock management is disabled, so it is an explicit
    // merchant choice, independent of quantity). When stock management is
    // enabled, WooCommerce derives the status from the quantity — that is
    // quantity-driven and must be ignored. An explicit out-of-stock is
    // NEVER overridden merely because inventoryMode is "unlimited".
    if (product.manageStock === false && product.stockStatus === "outofstock") {
      return false;
    }
    return true;
  }

  // Managed inventory mode — mirrors WooCommerce's own purchasability:
  // - explicit outofstock → unavailable
  // - onbackorder → backorders allowed → purchasable (Woo's is_in_stock
  //   returns true for onbackorder)
  // - stock=null → quantity unknown/not managed → available
  // - stock>0 → available; stock=0 → out of stock
  if (product.stockStatus === "outofstock") return false;
  if (product.stockStatus === "onbackorder") return true;
  if (product.stock === null) return true; // quantity unknown/not managed
  return product.stock > 0;
}

/**
 * Human-readable availability label, inventory-policy aware. Never
 * displays "out of stock" for unlimited-inventory products.
 */
export function availabilityLabel(
  product: CatalogProduct,
  inventoryMode: InventoryMode = "unlimited"
): string {
  if (!isProductAvailable(product, inventoryMode)) return "Out of stock";
  if (
    inventoryMode === "managed" &&
    product.stock !== null &&
    product.stock > 0
  ) {
    return `In stock (${product.stock})`;
  }
  return "Available";
}

// ─── Intent helpers ──────────────────────────────────────────

function productSearchText(product: CatalogProduct): string {
  const variantText = product.variants
    .map((v) => `${v.name} ${Object.values(v.attributes).join(" ")}`)
    .join(" ");
  return normalizeText(
    [product.name, product.category, product.description, product.sku, variantText]
      .filter(Boolean)
      .join(" ")
  );
}

export function detectCategoryKey(message: string): string | null {
  const text = normalizeText(message);
  for (const [key, words] of Object.entries(CATEGORY_ALIASES)) {
    if (words.some((word) => text.includes(normalizeText(word)))) return key;
  }
  return null;
}

/**
 * Extract a budget ceiling from the message.
 * Handles: "under 500", "500 taka", "500 tk", "৳500", "500 টাকার",
 * "250 takar ta", "500 takar moddhe", Bangla digits.
 */
export function extractBudget(message: string): number | null {
  const raw = String(message || "");
  const text = normalizeText(raw);

  const patterns = [
    /(?:under|below|within|max|maximum|budget|around|up to|less than|moddhe|moddhye)\s*(?:tk|taka)?\s*([০-৯\d]{2,7})/i,
    /(?:tk|taka|৳)\s*([০-৯\d]{2,7})/i,
    /([০-৯\d]{2,7})\s*(?:tk|taka|takar|টাকা|টাকার)\b/i,
  ];

  for (const pattern of patterns) {
    const match = raw.match(pattern) || text.match(pattern);
    if (match) {
      const value = String(match[1]).replace(/[০-৯]/g, (digit) => String("০১২৩৪৫৬৭৮৯".indexOf(digit)));
      const number = Number(value);
      if (number > 0) return number;
    }
  }
  return null;
}

export interface BudgetRange {
  min: number | null;
  max: number | null;
}

/**
 * Extract a price RANGE deterministically:
 *   "500 theke 1000"  → { min: 500, max: 1000 }
 *   "500-1000"        → { min: 500, max: 1000 }
 *   "500 to 1000 taka"→ { min: 500, max: 1000 }
 * Falls back to a single budget ceiling via extractBudget.
 */
export function extractBudgetRange(message: string): BudgetRange | null {
  const raw = String(message || "");
  const text = normalizeText(raw);

  const patterns = [
    // "500 theke 1000", "500 to 1000", "500 theke 1000 taka"
    /([০-৯\d]{2,7})\s*(?:theke|to|thekeo|থেকে)\s*([০-৯\d]{2,7})/i,
    // "500-1000", "500 - 1000", "৳500-1000"
    /(?:৳|tk|taka)?\s*([০-৯\d]{2,7})\s*[-–—]\s*([০-৯\d]{2,7})/i,
  ];

  for (const pattern of patterns) {
    const match = raw.match(pattern) || text.match(pattern);
    if (match) {
      const toDigits = (s: string) => Number(s.replace(/[০-৯]/g, (d) => String("০১২৩৪৫৬৭৮৯".indexOf(d))));
      const a = toDigits(match[1]);
      const b = toDigits(match[2]);
      if (a > 0 && b > 0) {
        return { min: Math.min(a, b), max: Math.max(a, b) };
      }
    }
  }

  const single = extractBudget(message);
  if (single) return { min: null, max: single };
  return null;
}

/**
 * Extract a quantity from the message ("2 ta", "৩টি", "3 pcs").
 */
export function extractQuantity(message: string): number {
  const match = String(message || "").match(
    /(?:^|\s)([০-৯\d]{1,2})(?![০-৯\d])\s*(?:ta|টি|টা|pcs?|pieces?|unit|x)/i
  );
  if (!match) return 1;
  const converted = match[1].replace(/[০-৯]/g, (digit) => String("০১২৩৪৫৬৭৮৯".indexOf(digit)));
  return Math.max(1, Math.min(Number(converted) || 1, 20));
}

/**
 * Detect a color mention ("Black ta dekhaw", "nil color ache?").
 */
export function detectColor(message: string): string | null {
  const text = normalizeText(message);
  for (const [color, words] of Object.entries(COLOR_WORDS)) {
    if (words.some((word) => text.includes(normalizeText(word)))) return color;
  }
  return null;
}

/**
 * Detect a size mention ("medium ta dao", "size 42", "XL lagbe").
 */
export function detectSize(message: string): string | null {
  const match = String(message || "").match(SIZE_PATTERN);
  if (!match) return null;
  const value = match[1].toLowerCase();
  const sizeMap: Record<string, string> = {
    small: "s",
    medium: "m",
    large: "l",
    "2xl": "xxl",
    "3xl": "3xl",
  };
  return sizeMap[value] || value;
}

const SHOW_PRODUCT_PATTERN =
  /(?:dekhao|dekhaw|dekha|দেখাও|দেখাব|দেখা|show|ei product|oi product|eta|eita|ei ta|oi ta|this product|that product)/i;

const GREETING_PATTERN =
  /^(?:hi+|hello+|hey+|assalam(?:u)?(?:alaikum)?|salam|salamualaikum|namaskar|nomoshkar|হাই|হ্যালো|আসসালামু|নমস্কার|ki khobor|kemon acho|koizen)[\s!।।.,]*$/i;

const ADD_TO_CART_PATTERN =
  /(?:add(?:\s*kore)?(?:\s*dao|dio|diyo|den|dib|dibo|koro|korben)?|cart(?:e)?\s*(?:add|jog|jogkor)|kine|kinbo|nibo|nite chai|eita chai|eta chai|ei ta chai|oi ta chai|চাই|কিনব|নিব|নিতে চাই|কার্টে|যোগ|কার্ট|order koro|order dao|add to cart|\b(?:dao|dio|diyo|den|nibo|nib|kinbo|kinum|chai|lagbe|dorkar)\b)/i;

// Note: no \b anchors — \b fails after Bangla combining marks (e.g. হ্যাঁ);
// the ^...$ anchors match the whole message instead.
const CONFIRMATION_PATTERN =
  /^(?:yes+|yeah|yep|ha+|haan|han|hmm ok|ok(?:ay)?|thik(?:\s*ache)?|thik e|sure|confirm|koro|koré|হ্যাঁ|হুম|ঠিক|ঠিক আছে|করো|জি)[\s!।।.,]*$/i;

/**
 * Detect messages that refer to a previously discussed product.
 */
export function referencesRecentProduct(message: string): boolean {
  return SHOW_PRODUCT_PATTERN.test(String(message || "")) || detectColor(message) !== null || detectSize(message) !== null;
}

export function isGreeting(message: string): boolean {
  return GREETING_PATTERN.test(String(message || "").trim());
}

/**
 * Detect add-to-cart intent ("2 ta dao", "eita chai", "add kore dao").
 */
export function wantsToAddToCart(message: string): boolean {
  return ADD_TO_CART_PATTERN.test(String(message || ""));
}

/**
 * Detect explicit confirmation ("yes", "হ্যাঁ", "thik ache").
 */
export function isConfirmation(message: string): boolean {
  return CONFIRMATION_PATTERN.test(String(message || "").trim());
}

/**
 * Detect a generic product query ("ki ki product ache?", "what do you
 * have", "show me everything") — a product-intent signal even without a
 * specific category/budget.
 */
const GENERIC_PRODUCT_QUERY_PATTERN =
  /(?:product|ponno|পণ্য|ki ache|কি আছে|কী আছে|kiki ache|what do you have|what do you sell|what(?:'s| is) available|available items|stock e|kothay)/i;

/**
 * Does the message show product-commerce intent (vs a general question)?
 * Used to gate the deterministic product flow: general questions go to
 * the LLM; product queries are handled deterministically.
 */
export function hasProductSignal(message: string): boolean {
  return (
    detectCategoryKey(message) !== null ||
    extractBudgetRange(message) !== null ||
    detectColor(message) !== null ||
    detectSize(message) !== null ||
    referencesRecentProduct(message) ||
    GENERIC_PRODUCT_QUERY_PATTERN.test(String(message || ""))
  );
}

// ─── Conversation follow-up context ──────────────────────────

const PRODUCT_MARKER_PATTERN = /\[PRODUCT:([^\]]+)\]/g;

/**
 * Extract product IDs from [PRODUCT:id] markers in conversation history.
 * The website chat saves assistant messages with markers (internal) so
 * short follow-ups like "Black ta dekhaw" can resolve to the previously
 * discussed product.
 */
export function extractProductIdsFromHistory(
  messages: Array<{ role: string; content: string }>,
  limit = 6
): string[] {
  const ids: string[] = [];
  const recent = [...messages].reverse();
  for (const item of recent) {
    const matches = String(item?.content || "").matchAll(PRODUCT_MARKER_PATTERN);
    for (const match of matches) {
      if (match[1] && !ids.includes(match[1])) ids.push(match[1]);
    }
    if (ids.length >= limit) break;
  }
  return ids;
}

/**
 * Extract product IDs mentioned in an AI response via [PRODUCT:id] markers.
 */
export function extractMentionedProductIds(text: string): string[] {
  const ids: string[] = [];
  const matches = String(text || "").matchAll(PRODUCT_MARKER_PATTERN);
  for (const match of matches) {
    if (match[1] && !ids.includes(match[1])) ids.push(match[1]);
  }
  return ids;
}

/**
 * Remove [PRODUCT:id] markers from response text (markers are internal;
 * the browser receives clean text plus structured product cards).
 */
export function stripProductMarkers(text: string): string {
  return String(text || "")
    .replace(PRODUCT_MARKER_PATTERN, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Sanitize LLM output for the widget:
 * - Remove Markdown table lines (the LLM must not produce product tables)
 * - Strip [PRODUCT:id] markers (internal)
 * - Collapse excessive newlines
 */
export function sanitizeAssistantText(text: string): string {
  const withoutTables = String(text || "")
    .split("\n")
    .filter((line) => !/^\s*\|/.test(line) && !/^\s*[-–—]{3,}\s*$/.test(line) && !/^\s*(?:#{1,6}\s)/.test(line))
    .join("\n");
  return stripProductMarkers(withoutTables);
}

// ─── Variant resolution (exact variation matching) ───────────

/**
 * Resolve the exact variation of a product from attribute mentions
 * ("black medium ta dao" → the black, medium variation).
 * Deterministic — the LLM never invents a variation ID.
 */
export function resolveVariant(
  product: CatalogProduct,
  attributes: { color?: string | null; size?: string | null },
  inventoryMode: InventoryMode = "unlimited"
): CatalogProduct["variants"][number] | null {
  if (!product.variants.length) return null;

  const color = attributes.color ? normalizeText(attributes.color) : null;
  const size = attributes.size ? normalizeText(attributes.size) : null;

  if (!color && !size) return null;

  const matches = product.variants.filter((v) => {
    const attrText = normalizeText(Object.values(v.attributes || {}).join(" ") + " " + v.name);
    const colorOk = !color || attrText.includes(color);
    const sizeOk = !size || attrText.includes(size);
    return colorOk && sizeOk;
  });

  if (matches.length === 1) return matches[0];

  // Prefer an available match when several match — inventory-policy aware
  const available = matches.filter(
    (v) =>
      inventoryMode === "unlimited" ||
      v.stock === null ||
      v.stock > 0
  );
  if (available.length >= 1) return available[0];
  return matches[0] || null;
}

/**
 * Check whether a product has a variant/attribute matching a color.
 */
export function productHasColor(product: CatalogProduct, color: string): boolean {
  const words = COLOR_WORDS[color] || [];
  const normalizedColor = normalizeText(color);
  const variantsText = normalizeText(
    product.variants.map((v) => `${v.name} ${Object.values(v.attributes).join(" ")}`).join(" ")
  );
  const nameText = normalizeText(product.name);
  return (
    variantsText.includes(normalizedColor) ||
    nameText.includes(normalizedColor) ||
    words.some((word) => variantsText.includes(normalizeText(word)) || nameText.includes(normalizeText(word)))
  );
}

/**
 * Find a product by name mention ("smart fitness watch" → matching product).
 * Deterministic fuzzy name matching over the catalog.
 */
export function findProductByName(catalog: CatalogProduct[], message: string): CatalogProduct | null {
  const text = normalizeText(message);
  if (!text) return null;

  let best: CatalogProduct | null = null;
  let bestScore = 0;

  for (const product of catalog) {
    const name = normalizeText(product.name);
    if (!name) continue;

    // Score: how much of the product name appears in the message
    const nameWords = name.split(" ").filter((w) => w.length > 1);
    if (!nameWords.length) continue;
    const matchedWords = nameWords.filter((w) => text.includes(w)).length;
    const score = matchedWords / nameWords.length;

    if (score > bestScore) {
      bestScore = score;
      best = product;
    }
  }

  // Require a meaningful name match (at least half the words, min 1)
  return bestScore >= 0.5 ? best : null;
}

// ─── Deterministic product selection ─────────────────────────

/**
 * Deterministically pick candidate products for a message.
 *
 * Priority:
 * 1. If the message references a recent product ("ei product ta dekhaw",
 *    "black ta dekhaw"), use the recently shown/selected products
 *    (filtered by color/size when mentioned).
 * 2. Otherwise filter by category (if detected), budget/range (if
 *    detected), and color (if detected).
 * 3. Sort: budget-sensitive → cheapest first; premium-curious → most
 *    expensive first; otherwise available first.
 */
export function pickProducts(
  catalog: CatalogProduct[],
  message: string,
  recentProductIds: string[] = [],
  inventoryMode: InventoryMode = "unlimited"
): CatalogProduct[] {
  const available = catalog.filter((p) => isProductAvailable(p, inventoryMode));
  const range = extractBudgetRange(message);
  const color = detectColor(message);
  const size = detectSize(message);
  const categoryKey = detectCategoryKey(message);

  // 1. Follow-up on a previously discussed product
  if (recentProductIds.length && referencesRecentProduct(message)) {
    const recent = recentProductIds
      .map((id) => catalog.find((p) => p.id === id))
      .filter((p): p is CatalogProduct => p !== undefined && p.status === "active");

    if (color) {
      const colorMatched = recent.filter((p) => productHasColor(p, color));
      if (colorMatched.length) return colorMatched;
    }
    if (recent.length) return recent;
  }

  let candidates = available;

  // 2. Category filter (aliases cover Bangla/Banglish/English + typos)
  if (categoryKey) {
    const words = CATEGORY_ALIASES[categoryKey].map(normalizeText).filter(Boolean);
    const byCategory = candidates.filter((p) => {
      const hay = productSearchText(p);
      return hay.includes(normalizeText(categoryKey)) || words.some((word) => hay.includes(word));
    });
    if (byCategory.length) candidates = byCategory;
  }

  // 3. Budget / price-range filter — deterministic, never delegated to the
  // LLM. An explicit budget query with no matches returns no candidates
  // (the API then says no matching products were found) — no fallback.
  if (range) {
    candidates = candidates.filter((p) => {
      if (range.max !== null && Number(p.price) > range.max) return false;
      if (range.min !== null && Number(p.price) < range.min) return false;
      return true;
    });
  }

  // 4. Color filter for direct color mentions ("black watch")
  if (color && !recentProductIds.length) {
    const colorMatched = candidates.filter((p) => productHasColor(p, color));
    if (colorMatched.length) candidates = colorMatched;
  }

  // ─── 5. Size filter for direct size mentions ─────────────
  if (size && !recentProductIds.length) {
    const normalizedSize = normalizeText(size);
    const sizeMatched = candidates.filter((p) =>
      p.variants.some((v) =>
        normalizeText(Object.values(v.attributes || {}).join(" ") + " " + v.name).includes(normalizedSize)
      )
    );
    if (sizeMatched.length) candidates = sizeMatched;
  }

  // 6. Sort by relevance
  const isBudgetSensitive = /(?:cheap|cheapest|low budget|lowest|affordable|budget|কম দাম|কম বাজেট|সস্তা|কম দামের|সাশ্রয়ী|কমে|কম টাকায়|কম টাকায়)/i.test(message);
  const isPremiumCurious = /(?:best|premium|latest|newest|flagship|top|ভালো|সেরা|প্রিমিয়াম|প্রিমিয়াম|লেটেস্ট|নতুন|দামি)/i.test(message);

  return [...candidates].sort((a, b) => {
    if (isBudgetSensitive) return Number(a.price) - Number(b.price);
    if (isPremiumCurious) return Number(b.price) - Number(a.price);
    return Number(a.price) - Number(b.price);
  });
}

// ─── Product cards ───────────────────────────────────────────

export function variantSummary(variant: { name: string; attributes: Record<string, string> }): string {
  const values = Object.values(variant.attributes || {}).filter(Boolean);
  return values.length ? values.join(", ") : variant.name;
}

function toCard(product: CatalogProduct, inventoryMode: InventoryMode): ProductCard {
  return {
    id: product.id,
    externalId: product.externalId,
    name: product.name,
    category: product.category,
    price: Number(product.price),
    compareAtPrice: product.compareAtPrice ? Number(product.compareAtPrice) : null,
    stock: product.stock,
    stockManaged: product.manageStock === true,
    available: isProductAvailable(product, inventoryMode),
    availability: availabilityLabel(product, inventoryMode),
    imageUrl: product.image || null,
    productUrl: product.productUrl || null,
    sku: product.sku || null,
    variants: [...new Set(product.variants.map(variantSummary))].filter(Boolean),
    variantOptions: product.variants.map((v) => ({
      id: v.id,
      externalId: v.externalId ?? null,
      name: v.name,
      attributes: v.attributes,
      price: Number(v.price),
      stock: v.stock,
      available: inventoryMode === "unlimited" || v.stock === null || v.stock > 0,
    })),
  };
}

/**
 * Build structured product cards from catalog products.
 * Only REAL data from the database is included — the AI never invents
 * product URLs, images, prices, stock, or variants. Archived products are
 * never included. Availability follows the merchant's inventory policy.
 */
export function buildProductCards(
  catalog: CatalogProduct[],
  ids: string[],
  max = 4,
  inventoryMode: InventoryMode = "unlimited"
): ProductCard[] {
  const seen = new Set<string>();
  const cards: ProductCard[] = [];

  for (const id of ids) {
    if (cards.length >= max) break;
    const product = catalog.find((p) => p.id === id);
    if (!product || seen.has(product.id)) continue;
    if (product.status !== "active") continue; // deleted/archived never shown
    seen.add(product.id);
    cards.push(toCard(product, inventoryMode));
  }

  if (cards.length === 0) {
    // No IDs matched — fall back to the first available catalog products
    for (const product of catalog) {
      if (cards.length >= max) break;
      if (!isProductAvailable(product, inventoryMode)) continue;
      if (seen.has(product.id)) continue;
      seen.add(product.id);
      cards.push(toCard(product, inventoryMode));
    }
  }

  return cards;
}

// ─── Deterministic text builders (short, shopping-assistant tone) ──

function money(value: number): string {
  return `\u09F3${Number(value || 0).toLocaleString("en-IN")}`;
}

export function buildGreetingText(siteName: string | null): string {
  return `Hi! I'm Karta, your AI shopping assistant${siteName ? ` for ${siteName}` : ""}. What are you looking for today?`;
}

/**
 * Detect Bangla script so replies match the customer's language.
 */
export function hasBanglaScript(message: string): boolean {
  return /[\u0980-\u09FF]/.test(String(message || ""));
}

const INTROS_BANGLA = [
  "অবশ্যই 😊 কয়েকটা পণ্য দেখাচ্ছি:",
  "এইগুলো পাওয়া যাচ্ছে দেখুন:",
  "কয়েকটা অপশন দেখাচ্ছি আপনার জন্য:",
];

const INTROS_ENGLISH = [
  "Sure! Here's what I found:",
  "Here are some options for you:",
  "A few products you might like:",
];

export function buildIntroText(
  candidates: CatalogProduct[],
  message: string
): string {
  if (!candidates.length) return "";

  // A single exact product match gets a direct name-mentioning response
  if (candidates.length === 1) {
    const name = candidates[0].name;
    return hasBanglaScript(message)
      ? `জি, ${name} আছে।`
      : `Yes, ${name} is available.`;
  }

  const bangla = hasBanglaScript(message);
  const list = bangla ? INTROS_BANGLA : INTROS_ENGLISH;
  // Deterministic variety: rotate by a simple hash of the message
  const hash = String(message || "").length + candidates.length;
  return list[hash % list.length];
}

/**
 * Deterministic fallback when the AI provider is unavailable/rate limited.
 * Concise, customer-safe — never mentions provider errors.
 */
export function buildProviderFallbackText(message: string): string {
  return hasBanglaScript(message)
    ? "আমি এই মুহূর্তে জটিল প্রশ্নের উত্তর দিতে একটু সমস্যায় আছি। পণ্য, দাম ও availability নিয়ে জিজ্ঞেস করলে আমি সাথে সাথে সাহায্য করতে পারব 😊"
    : "I'm having trouble with complex questions right now. For products, prices, and availability I can still help instantly — just ask! 😊";
}

export function buildNoMatchText(): string {
  return "দুঃখিত, আমি আপনার জন্য কোনো মিলে যাওয়া পণ্য খুঁজে পাইনি। আপনি কী খুঁজছেন একটু বিস্তারিত বলতে পারেন? 😊";
}

export function buildConfirmationQuestion(product: CatalogProduct, quantity: number, variant: CatalogProduct["variants"][number] | null): string {
  const price = variant ? Number(variant.price) : Number(product.price);
  const name = variant && variant.name ? `${product.name} (${variant.name})` : product.name;
  const qty = quantity > 1 ? `${quantity} টি ` : "";
  return `${name} — ${money(price)}। ${qty}কার্টে যোগ করব?`;
}

export function buildPriceAnswer(product: CatalogProduct, variant: CatalogProduct["variants"][number] | null): string {
  const price = variant ? Number(variant.price) : Number(product.price);
  const regular = product.compareAtPrice ? Number(product.compareAtPrice) : null;
  const name = variant && variant.name ? `${product.name} (${variant.name})` : product.name;
  if (regular && regular > price) {
    return `${name} এর দাম ${money(price)} (রেগুলার প্রাইস ছিল ${money(regular)})।`;
  }
  return `${name} এর দাম ${money(price)}।`;
}

export function buildBudgetCheckText(product: CatalogProduct, variant: CatalogProduct["variants"][number] | null, budget: number): string {
  const price = variant ? Number(variant.price) : Number(product.price);
  const name = variant && variant.name ? `${product.name} (${variant.name})` : product.name;
  if (price <= budget) {
    return `হ্যাঁ, ${name} এর দাম ${money(price)} — আপনার ${money(budget)} বাজেটের মধ্যে আছে 😊`;
  }
  return `${name} এর দাম ${money(price)} — আপনার ${money(budget)} বাজেটের বাইরে।`;
}

export function buildAddedText(product: CatalogProduct, quantity: number): string {
  const qty = quantity > 1 ? `${quantity} টি ` : "";
  return `${product.name} ${qty}কার্টে যোগ হয়েছে ✅ চেকআউট করতে চাইলে কার্ট পেজে যান।`;
}
