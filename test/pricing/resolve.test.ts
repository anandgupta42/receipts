// R2 test matrix rows: dated pricing windows, no-match/no-fallback.
//
// Unlike R1 (ported from the private repo), SPEC-0001 explicitly mandates
// that `src/pricing/**` is WRITTEN FRESH — the private repo's `cost.ts`
// regex-family-match + default-tier fallback is explicitly banned (violates
// I2: never fabricate a dollar). There is therefore no naming precedent to
// port from, unlike R1's `loadById`/`adapters`/etc.
//
// Because the exact resolver export name can't be evidenced the way R1's
// could, this file probes several plausible candidates independently and
// documents each. Whichever one core-engine actually lands, update the
// `candidates` list below to match — the assertions encode SPEC-0001's R2
// acceptance criteria (exact model id + date window match, non-match falls
// back to tokens-only / null, never a guessed or family-fallback price) and
// should not need to change.
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, expect, it } from "vitest";

const contracts = await import("../../src/index.js").catch(() => null);

// Plausible resolver export names, in order of likelihood given SPEC-0001's
// R2 description ("resolve exact model id + session date against
// data/prices/<vendor>.json by from_date/to_date window").
const candidateNames = [
  "resolvePrice",
  "resolvePriceForModel",
  "resolveModelPrice",
  "priceForModel",
];

const resolverName = candidateNames.find(
  (name) => typeof (contracts as Record<string, unknown> | null)?.[name] === "function",
);
const resolvePrice = resolverName
  ? (contracts as Record<string, (...args: unknown[]) => unknown>)[resolverName]
  : undefined;

if (!resolvePrice) {
  console.warn(
    "[BLOCKED] R2 pricing-resolver tests skipped: src/index.ts has not exported a " +
      `price-resolution function yet (tried: ${candidateNames.join(", ")}). ` +
      "core-engine's src/pricing/** is written fresh per SPEC-0001 (no port source), " +
      "so this name could not be evidenced the way R1's adapter contracts were — " +
      "update `candidateNames` above once core-engine lands the real export.",
  );
}

const dataDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../data/prices",
);

describe.skipIf(!resolvePrice)("price resolution (R2)", () => {
  it("resolves claude-opus-4-8 on a date inside its open-ended window", async () => {
    const result = await resolvePrice!("anthropic", "claude-opus-4-8", "2026-06-15", dataDir);
    expect(result).not.toBeNull();
    expect((result as { input: number }).input).toBe(5.0);
    expect((result as { output: number }).output).toBe(25.0);
  });

  it("resolves claude-sonnet-5 to the introductory row before 2026-09-01", async () => {
    const result = await resolvePrice!("anthropic", "claude-sonnet-5", "2026-06-15", dataDir);
    expect(result).not.toBeNull();
    expect((result as { input: number }).input).toBe(2.0);
    expect((result as { output: number }).output).toBe(10.0);
  });

  it("resolves claude-sonnet-5 to the standard row on/after 2026-09-01", async () => {
    const result = await resolvePrice!("anthropic", "claude-sonnet-5", "2026-09-01", dataDir);
    expect(result).not.toBeNull();
    expect((result as { input: number }).input).toBe(3.0);
    expect((result as { output: number }).output).toBe(15.0);
  });

  it("resolves the day-boundary correctly: 2026-08-31 still uses the introductory row", async () => {
    const result = await resolvePrice!("anthropic", "claude-sonnet-5", "2026-08-31", dataDir);
    expect(result).not.toBeNull();
    expect((result as { input: number }).input).toBe(2.0);
  });

  it("returns null (not a fallback price) for an unknown model id — no family guessing", async () => {
    const result = await resolvePrice!(
      "anthropic",
      "claude-opus-9000-does-not-exist",
      "2026-06-15",
      dataDir,
    );
    expect(result).toBeNull();
  });

  it("returns null (not a fallback price) for a date before any row's from_date", async () => {
    const result = await resolvePrice!("anthropic", "claude-opus-4-8", "2020-01-01", dataDir);
    expect(result).toBeNull();
  });

  it("never returns a price for one vendor when queried against another vendor's model id", async () => {
    const result = await resolvePrice!("openai", "claude-opus-4-8", "2026-06-15", dataDir);
    expect(result).toBeNull();
  });
});
