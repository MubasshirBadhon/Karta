/**
 * Deterministic Catalog Matcher
 *
 * Deterministic natural-language understanding for the website chat widget.
 * This module intentionally does NOT call an LLM and does NOT modify
 * carts/orders. It is the first stage of the website AI flow:
 *
 *   1. Deterministic catalog/product matching (this module, DB-backed)
 *   2. AI for natural-language understanding/response (commerce engine)
 *
 * The LLM is never the source of truth for products, prices, stock,
 * variants, URLs, or images — all product data comes from the database
 * via these deterministic functions.
 *
 * Understands Bangla, Banglish, English, mixed input, and common
 * transliteration/spelling mistakes. Supports budget queries, category
 * queries, product follow-ups, variant/color questions, and quantity
 * questions.
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
  bag: ["bag", "ব্যাগ", "ব্যাকপ্যাক", "backpack", "back pack", "purse", "পার্স"],
  shoes: ["shoe", "shoes", "জুতা", "জুতো", "juta", "sneaker", "sneakers"],
  clothes: ["dress", "clothes", "cloth", "fashion", "জামা", "পোশাক", "কাপড়", "কাপড", "শার্ট", "প্যান্ট", "shirt", "pant", "tshirt", "t-shirt"],
  skincare: ["skincare", "skin care", "facewash", "face wash", "cleanser", "sunscreen", "সানস্ক্রিন", "ফেসওয়াশ", "ফেসওয়াশ"],
  speaker: ["speaker", "স্পিকার", "soundbox", "sound box"],
  camera: ["camera", "ক্যামেরা"],
  laptop: ["laptop", "ল্যাপটপ", "লেপটপ"],
  phone: ["phone", "mobile", "মোবাইল", "ফোন"],
  mouse: ["mouse", "মাউস", "মাউস"],
  monitor: ["monitor", "মনিটর"],
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
};

// ─── Product input shape (from Prisma, with variants) ─────────

export interface CatalogProduct {
  id: string;
  externalId: string | null;
  name: string;
  description: string | null;
  price: number;
  compareAtPrice: number | null;
  stock: number | null; // null = stock not managed (available), 0 = out of stock
  status: string;
  image: string | null;
  productUrl: string | null;
  sku: string | null;
  category: string | null;
  variants: Array<{
    id: string;
    name: string;
    attributes: Record<string, string>;
    price: number;
    stock: number | null;
  }>;
}

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
  imageUrl: string | null;
  productUrl: string | null;
  sku: string | null;
  variants: string[];
  variantOptions: Array<{ name: string; attributes: Record<string, string>; price: number; stock: number | null }>;
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
 * Extract a budget from the message.
 * Handles: "under 500", "500 taka", "500 tk", "৳500", "500 টাকার",
 * "250 takar ta", Bangla digits.
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

const SHOW_PRODUCT_PATTERN =
  /(?:dekhao|dekhaw|dekha|দেখাও|দেখাব|দেখা|show|ei product|oi product|eta|eita|ei ta|oi ta|this product|that product)/i;

const GREETING_PATTERN =
  /^(?:hi+|hello+|hey+|assalam(?:u)?(?:alaikum)?|salam|salamualaikum|namaskar|nomoshkar|হাই|হ্যালো|হ্যালো|আসসালামু|নমস্কার|ki khobor|kemon acho|koizen)\b[\s!।।.]*$/i;

/**
 * Detect messages that refer to a previously discussed product.
 */
export function referencesRecentProduct(message: string): boolean {
  return SHOW_PRODUCT_PATTERN.test(String(message || "")) || detectColor(message) !== null;
}

export function isGreeting(message: string): boolean {
  return GREETING_PATTERN.test(String(message || "").trim());
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

// ─── Deterministic product selection ─────────────────────────

/**
 * Deterministically pick candidate products for a message.
 *
 * Priority:
 * 1. If the message references a recent product ("ei product ta dekhaw",
 *    "black ta dekhaw"), use the recently shown products (filtered by
 *    color/attribute when one is mentioned).
 * 2. Otherwise filter by category (if detected) and budget (if detected).
 * 3. Sort by relevance: budget-sensitive → cheapest first;
 *    premium-curious → most expensive first; otherwise in-stock first.
 */
export function pickProducts(
  catalog: CatalogProduct[],
  message: string,
  recentProductIds: string[] = []
): CatalogProduct[] {
  const inStock = catalog.filter((p) => p.stock === null || p.stock > 0);
  const budget = extractBudget(message);
  const color = detectColor(message);
  const categoryKey = detectCategoryKey(message);

  // 1. Follow-up on a previously discussed product
  if (recentProductIds.length && referencesRecentProduct(message)) {
    const recent = recentProductIds
      .map((id) => catalog.find((p) => p.id === id))
      .filter((p): p is CatalogProduct => Boolean(p));

    if (color) {
      const colorMatched = recent.filter((p) => productHasColor(p, color));
      if (colorMatched.length) return colorMatched;
    }
    if (recent.length) return recent;
  }

  let candidates = inStock;

  // 2. Category filter (aliases cover Bangla/Banglish/English + typos)
  if (categoryKey) {
    const words = CATEGORY_ALIASES[categoryKey].map(normalizeText).filter(Boolean);
    const byCategory = candidates.filter((p) => {
      const hay = productSearchText(p);
      return hay.includes(normalizeText(categoryKey)) || words.some((word) => hay.includes(word));
    });
    if (byCategory.length) candidates = byCategory;
  }

  // 3. Budget filter
  if (budget) {
    const within = candidates.filter((p) => Number(p.price) <= budget);
    if (within.length) candidates = within;
  }

  // 4. Sort by relevance
  const isBudgetSensitive = /(?:cheap|cheapest|low budget|lowest|affordable|budget|কম দাম|কম বাজেট|সস্তা|কম দামের|সাশ্রয়ী|কমে|কম টাকায়|কম টাকায়)/i.test(message);
  const isPremiumCurious = /(?:best|premium|latest|newest|flagship|top|ভালো|সেরা|প্রিমিয়াম|প্রিমিয়াম|লেটেস্ট|নতুন|দামি)/i.test(message);

  return [...candidates].sort((a, b) => {
    if (isBudgetSensitive) return Number(a.price) - Number(b.price);
    if (isPremiumCurious) return Number(b.price) - Number(a.price);
    const aAvailable = a.stock === null ? 1 : a.stock > 0 ? 1 : 0;
    const bAvailable = b.stock === null ? 1 : b.stock > 0 ? 1 : 0;
    return bAvailable - aAvailable || Number(a.price) - Number(b.price);
  });
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

// ─── Product cards ───────────────────────────────────────────

function variantSummary(variant: { name: string; attributes: Record<string, string> }): string {
  const values = Object.values(variant.attributes || {}).filter(Boolean);
  return values.length ? values.join(", ") : variant.name;
}

/**
 * Build structured product cards from catalog products.
 * Only REAL data from the database is included — the AI never invents
 * product URLs, images, prices, stock, or variants.
 *
 * Cards include up to `max` products. Out-of-stock products are included
 * only when explicitly requested by ID (e.g. a follow-up on a specific
 * product) so availability can be shown honestly.
 */
export function buildProductCards(
  catalog: CatalogProduct[],
  ids: string[],
  max = 4
): ProductCard[] {
  const wanted = new Set(ids.map(String));
  const seen = new Set<string>();
  const cards: ProductCard[] = [];

  for (const id of ids) {
    if (cards.length >= max) break;
    const product = catalog.find((p) => p.id === id);
    if (!product || seen.has(product.id)) continue;
    seen.add(product.id);

    cards.push(toCard(product));
  }

  if (cards.length === 0) {
    // No IDs matched — fall back to the first available catalog products
    for (const product of catalog) {
      if (cards.length >= max) break;
      if (product.stock !== null && product.stock <= 0) continue;
      if (seen.has(product.id)) continue;
      seen.add(product.id);
      cards.push(toCard(product));
    }
  }

  void wanted;
  return cards;
}

function toCard(product: CatalogProduct): ProductCard {
  return {
    id: product.id,
    externalId: product.externalId,
    name: product.name,
    category: product.category,
    price: Number(product.price),
    compareAtPrice: product.compareAtPrice ? Number(product.compareAtPrice) : null,
    stock: product.stock,
    stockManaged: product.stock !== null,
    available: product.stock === null ? product.status === "active" : product.stock > 0,
    imageUrl: product.image || null,
    productUrl: product.productUrl || null,
    sku: product.sku || null,
    variants: [...new Set(product.variants.map(variantSummary))].filter(Boolean),
    variantOptions: product.variants.map((v) => ({
      name: v.name,
      attributes: v.attributes,
      price: Number(v.price),
      stock: v.stock,
    })),
  };
}
