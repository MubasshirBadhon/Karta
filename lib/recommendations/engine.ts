import type { CustomerProfile } from "@/lib/intelligence/profile";
import type { CatalogProduct, InventoryMode } from "@/lib/commerce/catalog-matcher";
import { isProductAvailable } from "@/lib/commerce/catalog-matcher";

/**
 * Recommendation Engine
 *
 * DETERMINISTIC and EXPLAINABLE. Receives the customer profile, the
 * current conversation intent/context, the budget if known, the current
 * catalog, and the availability policy — returns ranked candidate
 * products with human-readable reasons.
 *
 * The LLM never invents recommendation candidates: it only turns these
 * deterministic candidates into natural language.
 *
 * Rules:
 * - Archived and unavailable products are NEVER recommended.
 * - Products the customer dismissed (safely inferable rejections) are
 *   suppressed.
 * - The product currently being discussed is excluded from "also like"
 *   suggestions.
 * - Scoring is transparent: every candidate carries a reason.
 */

export interface RecommendationInput {
  profile?: CustomerProfile | null;
  /** Current conversation intent (e.g. PRODUCT_SEARCH, BUDGET_CHECK) */
  intent?: string | null;
  /** Current product/category context */
  category?: string | null;
  currentProductId?: string | null;
  budget?: number | null;
  catalog: CatalogProduct[];
  inventoryMode?: InventoryMode;
  max?: number;
}

export interface Recommendation {
  product: CatalogProduct;
  score: number;
  reason: string;
}

/**
 * Complementary-product relationships (merchant-configurable business
 * rules; extendable later via configuration). Simple, transparent pairs.
 */
const COMPLEMENTARY: Record<string, string[]> = {
  shirt: ["jeans", "pant", "shoes", "dress"],
  tshirt: ["jeans", "pant", "shoes"],
  clothes: ["shoes", "bag"],
  watch: ["bag", "wallet"],
  shoes: ["bag", "clothes"],
  phone: ["charger", "headphone", "bag"],
  laptop: ["mouse", "bag", "headphone"],
  headphone: ["phone", "charger"],
  earbuds: ["phone", "charger"],
  camera: ["bag", "charger"],
  speaker: ["phone", "charger"],
  bottle: ["bag"],
  wallet: ["watch", "bag"],
  bag: ["wallet", "shoes"],
  charger: ["phone", "headphone", "earbuds"],
  keyboard: ["mouse", "monitor"],
  mouse: ["keyboard", "monitor"],
  monitor: ["keyboard", "mouse"],
};

function normalize(value: string | null | undefined): string {
  return String(value || "").toLowerCase().trim();
}

/**
 * Generate ranked recommendation candidates.
 */
export function recommend(input: RecommendationInput): Recommendation[] {
  const { profile, category, currentProductId, budget, catalog } = input;
  const inventoryMode = input.inventoryMode ?? "unlimited";
  const max = input.max ?? 3;

  const interests = new Set((profile?.interestedCategories ?? []).map(normalize));
  const viewed = new Set(profile?.viewedProductIds ?? []);
  const purchased = new Set(
    Object.entries(profile?.purchasedCategoryCounts ?? {})
      .filter(([, count]) => count > 0)
      .map(([cat]) => normalize(cat))
  );
  const dismissed = new Set(profile?.dismissedProductIds ?? []);

  const scored: Recommendation[] = [];

  for (const product of catalog) {
    // Archived/unavailable products are NEVER recommended
    if (product.status !== "active") continue;
    if (!isProductAvailable(product, inventoryMode)) continue;

    // The product currently being discussed is excluded
    if (currentProductId && product.id === currentProductId) continue;

    // Suppression: products the customer dismissed are not re-recommended
    if (dismissed.has(product.id)) continue;

    let score = 0;
    const reasons: string[] = [];

    const productCategory = normalize(product.category);
    const searchText = normalize(
      [product.name, product.description, product.category].filter(Boolean).join(" ")
    );

    // 1. Category relevance (the current conversation context)
    if (category && (productCategory === normalize(category) || searchText.includes(normalize(category)))) {
      score += 3;
      reasons.push("matches what you're looking for");
    }

    // 2. Complementary to the currently discussed product
    if (currentProductId) {
      const current = catalog.find((p) => p.id === currentProductId);
      const currentCategory = normalize(current?.category);
      const complements =
        (COMPLEMENTARY[currentCategory] ?? []).some((c) => productCategory === c || searchText.includes(c)) ||
        (COMPLEMENTARY[productCategory] ?? []).some((c) => currentCategory === c);
      if (complements) {
        score += 4;
        reasons.push("goes well with what you're viewing");
      } else if (currentCategory && productCategory === currentCategory) {
        // Same category, different product — an alternative
        score += 2;
        reasons.push("another option you might like");
      }
    }

    // 3. Similarity to viewed/purchased products (profile interests)
    if (interests.size && (interests.has(productCategory) || [...interests].some((i) => searchText.includes(i)))) {
      score += 2;
      reasons.push("based on your recent interests");
    }
    if (purchased.has(productCategory)) {
      score += 1;
      reasons.push("from a category you've bought from before");
    }
    if (viewed.has(product.id)) {
      // Already seen — down-rank for "also like" suggestions
      score -= 1;
    }

    // 4. Budget compatibility (deterministic)
    if (budget && Number(product.price) <= budget) {
      score += 2;
      reasons.push("within your budget");
    } else if (budget) {
      score -= 2;
    }

    // 5. Recent interaction (events) — a slight boost for engaged products
    if (profile?.clickedProductIds?.includes(product.id)) {
      score += 1;
    }

    if (score <= 0) continue;

    scored.push({
      product,
      score,
      reason: reasons[0] ?? "recommended for you",
    });
  }

  // Sort by score (stable, deterministic), then price ascending
  return scored
    .sort((a, b) => b.score - a.score || Number(a.product.price) - Number(b.product.price))
    .slice(0, max);
}
