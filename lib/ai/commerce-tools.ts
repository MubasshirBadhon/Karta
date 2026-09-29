import { z } from "zod";
import {
  searchProducts,
  getProduct,
  getVariant,
  checkStock,
  type ProductSearchResult,
  type ProductDetails,
  type VariantInfo,
  type StockInfo,
} from "@/lib/commerce/service";

/**
 * AI Commerce Tools
 *
 * These are the ONLY tools the AI can use to access commerce data.
 * Each tool validates input with Zod and calls the deterministic commerce service.
 * The AI NEVER directly accesses the database.
 */

// ─── Tool Input Schemas ───────────────────────────────────────

const SearchProductsInput = z.object({
  query: z.string().optional().describe("Search term for product name or description"),
  minPrice: z.number().optional().describe("Minimum price filter"),
  maxPrice: z.number().optional().describe("Maximum price filter"),
  limit: z.number().min(1).max(20).default(20).describe("Maximum results to return"),
});

const GetProductInput = z.object({
  productId: z.string().describe("The product ID or slug"),
});

const GetVariantInput = z.object({
  productId: z.string().describe("The product ID"),
  variantId: z.string().optional().describe("Specific variant ID"),
  attributes: z.record(z.string()).optional().describe("Variant attributes to match, e.g. {color: 'black', size: '42'}"),
});

const CheckStockInput = z.object({
  productId: z.string().describe("The product ID"),
  variantId: z.string().optional().describe("Specific variant ID"),
});

// ─── Tool Definitions ─────────────────────────────────────────

export interface CommerceTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute: (tenantId: string, input: unknown) => Promise<unknown>;
}

export const commerceTools: CommerceTool[] = [
  {
    name: "search_products",
    description: "Search for products in the catalog. Use this when the customer wants to find products, browse, or asks what's available.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search term for product name or description" },
        minPrice: { type: "number", description: "Minimum price" },
        maxPrice: { type: "number", description: "Maximum price" },
        limit: { type: "number", description: "Max results (1-20)", default: 20 },
      },
    },
    execute: async (tenantId: string, input: unknown) => {
      const parsed = SearchProductsInput.parse(input);
      const results: ProductSearchResult[] = await searchProducts(
        tenantId,
        parsed.query || "",
        { minPrice: parsed.minPrice, maxPrice: parsed.maxPrice, limit: parsed.limit }
      );
      return results.map((p) => ({
        id: p.id,
        name: p.name,
        price: p.price,
        compareAtPrice: p.compareAtPrice,
        stock: p.stock,
        status: p.status,
      }));
    },
  },
  {
    name: "get_product",
    description: "Get detailed information about a specific product including all variants. Use when customer asks about a specific product's details, price, or available options.",
    parameters: {
      type: "object",
      properties: {
        productId: { type: "string", description: "The product ID or slug" },
      },
      required: ["productId"],
    },
    execute: async (tenantId: string, input: unknown) => {
      const parsed = GetProductInput.parse(input);
      const product: ProductDetails | null = await getProduct(tenantId, parsed.productId);
      if (!product) return null;
      return {
        id: product.id,
        name: product.name,
        description: product.description,
        price: product.price,
        compareAtPrice: product.compareAtPrice,
        stock: product.stock,
        status: product.status,
        variants: product.variants.map((v) => ({
          id: v.id,
          name: v.name,
          attributes: v.attributes,
          price: v.price,
          stock: v.stock,
          sku: v.sku,
        })),
      };
    },
  },
  {
    name: "get_variant",
    description: "Get information about a specific product variant or find a variant by attributes. Use when customer asks about specific size, color, or other variant options.",
    parameters: {
      type: "object",
      properties: {
        productId: { type: "string", description: "The product ID" },
        variantId: { type: "string", description: "Specific variant ID" },
        attributes: { type: "object", description: "Attributes to match, e.g. {color: 'black', size: '42'}" },
      },
      required: ["productId"],
    },
    execute: async (tenantId: string, input: unknown) => {
      const parsed = GetVariantInput.parse(input);

      // If variantId is provided, get that specific variant
      if (parsed.variantId) {
        const variant: VariantInfo | null = await getVariant(tenantId, parsed.variantId);
        if (!variant) return null;
        return {
          id: variant.id,
          name: variant.name,
          attributes: variant.attributes,
          price: variant.price,
          stock: variant.stock,
          sku: variant.sku,
        };
      }

      // If attributes are provided, find matching variant
      if (parsed.attributes) {
        const product: ProductDetails | null = await getProduct(tenantId, parsed.productId);
        if (!product) return null;

        const matching = product.variants.filter((v) => {
          return Object.entries(parsed.attributes!).every(
            ([key, value]) => v.attributes[key] === value
          );
        });

        return matching.map((v) => ({
          id: v.id,
          name: v.name,
          attributes: v.attributes,
          price: v.price,
          stock: v.stock,
          sku: v.sku,
        }));
      }

      // If neither provided, return all variants
      const product: ProductDetails | null = await getProduct(tenantId, parsed.productId);
      if (!product) return null;
      return product.variants.map((v) => ({
        id: v.id,
        name: v.name,
        attributes: v.attributes,
        price: v.price,
        stock: v.stock,
        sku: v.sku,
      }));
    },
  },
  {
    name: "check_stock",
    description: "Check if a product or variant is in stock. Use when customer asks about availability or stock status.",
    parameters: {
      type: "object",
      properties: {
        productId: { type: "string", description: "The product ID" },
        variantId: { type: "string", description: "Specific variant ID" },
      },
      required: ["productId"],
    },
    execute: async (tenantId: string, input: unknown) => {
      const parsed = CheckStockInput.parse(input);
      const stock: StockInfo = await checkStock(tenantId, parsed.productId, parsed.variantId);
      return {
        productId: stock.productId,
        variantId: stock.variantId,
        stock: stock.stock,
        available: stock.available,
      };
    },
  },
];

/**
 * Get tool definitions formatted for Groq's API.
 */
export function getToolDefinitions() {
  return commerceTools.map((tool) => ({
    type: "function" as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }));
}

/**
 * Execute a commerce tool by name.
 * Only registered tools can be executed — arbitrary tool names are rejected.
 */
export async function executeTool(
  tenantId: string,
  toolName: string,
  args: unknown
): Promise<unknown> {
  const tool = commerceTools.find((t) => t.name === toolName);
  if (!tool) {
    throw new Error(`Unknown tool: ${toolName}`);
  }
  return tool.execute(tenantId, args);
}
