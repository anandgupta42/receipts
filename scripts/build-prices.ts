#!/usr/bin/env -S node --experimental-strip-types
// Compiles the per-vendor JSON files under data/prices/ into the single lookup
// table src/pricing/ consumes at runtime (a build step, not a network fetch —
// I1: zero network in the product path. This runs at build time only).
//
// TODO(M1+): implement once data/prices/*.json vendor files exist.
//   - Read every data/prices/<vendor>.json.
//   - Validate schema (see data/prices/README.md) and that price_history rows
//     are date-ordered with no gaps/overlaps per model.
//   - Emit a single generated lookup module (e.g. src/pricing/generated/prices.ts)
//     consumed by src/pricing/ at runtime — no disk/network reads at runtime.

async function main(): Promise<void> {
  console.log("build-prices: no price tables exist yet (Tier 0 harness) — nothing to build.");
  process.exit(0);
}

void main();
