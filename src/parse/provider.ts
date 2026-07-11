import type { DirectPricingProvider } from "./types.js";

const DIRECT_PROVIDERS = new Set<DirectPricingProvider>(["anthropic", "openai", "google", "deepseek"]);

/**
 * Normalize explicit transcript provider evidence for pricing. Missing evidence
 * stays `undefined` (legacy inference); any present but non-direct value becomes
 * `null` so routed/custom traffic can never inherit a first-party price.
 */
export function normalizePricingProvider(value: unknown): DirectPricingProvider | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string" || value.trim() === "") {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  return DIRECT_PROVIDERS.has(normalized as DirectPricingProvider)
    ? (normalized as DirectPricingProvider)
    : null;
}
