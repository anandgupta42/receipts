// Direct unit tests for `src/pricing/priceTable.ts` — the lowest-scoring
// file under mutation (28.26%: 13 killed / 27 survived / 6 no-coverage).
// `loadPriceTable` never throws (I1); every failure mode — missing file,
// malformed JSON, and each individual shape-validation clause — must
// collapse to `null` rather than propagate an exception. Each branch below
// is isolated with a synthetic file in a temp dir so a mutant that flips
// any one guard clause (`parsed &&`, `typeof parsed.vendor === "string"`,
// `parsed.models &&`, `typeof parsed.models === "object"`) is caught
// independently of the others.
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { defaultDataDir, loadPriceTable } from "../../src/pricing/priceTable.js";

const tempDir = mkdtempSync(path.join(tmpdir(), "aireceipts-price-table-loader-"));
afterAll(() => rmSync(tempDir, { recursive: true, force: true }));

function write(name: string, content: string): void {
  writeFileSync(path.join(tempDir, `${name}.json`), content);
}

describe("loadPriceTable", () => {
  it("round-trips a well-formed table", async () => {
    write("valid-vendor", JSON.stringify({ vendor: "valid-vendor", models: { "model-a": { price_history: [] } } }));
    const result = await loadPriceTable("valid-vendor", tempDir);
    expect(result).toEqual({ vendor: "valid-vendor", models: { "model-a": { price_history: [] } } });
  });

  it("returns null for a nonexistent file path", async () => {
    const result = await loadPriceTable("does-not-exist-anywhere", tempDir);
    expect(result).toBeNull();
  });

  it("returns null for syntactically malformed JSON", async () => {
    write("malformed", "{ vendor: this is not valid JSON");
    const result = await loadPriceTable("malformed", tempDir);
    expect(result).toBeNull();
  });

  it("returns null when the JSON parses to the literal value null", async () => {
    write("literal-null", "null");
    const result = await loadPriceTable("literal-null", tempDir);
    expect(result).toBeNull();
  });

  it("returns null when the JSON is a top-level array (object-typeof but no vendor/models fields)", async () => {
    write("is-array", "[1, 2, 3]");
    const result = await loadPriceTable("is-array", tempDir);
    expect(result).toBeNull();
  });

  it("returns null when vendor is missing entirely", async () => {
    write("no-vendor", JSON.stringify({ models: {} }));
    const result = await loadPriceTable("no-vendor", tempDir);
    expect(result).toBeNull();
  });

  it("returns null when vendor is present but not a string", async () => {
    write("vendor-not-string", JSON.stringify({ vendor: 42, models: {} }));
    const result = await loadPriceTable("vendor-not-string", tempDir);
    expect(result).toBeNull();
  });

  it("returns null when models is missing entirely", async () => {
    write("no-models", JSON.stringify({ vendor: "x" }));
    const result = await loadPriceTable("no-models", tempDir);
    expect(result).toBeNull();
  });

  it("returns null when models is explicitly null", async () => {
    write("models-null", JSON.stringify({ vendor: "x", models: null }));
    const result = await loadPriceTable("models-null", tempDir);
    expect(result).toBeNull();
  });

  it("returns null when models is present but not an object (a string)", async () => {
    write("models-not-object", JSON.stringify({ vendor: "x", models: "not-an-object" }));
    const result = await loadPriceTable("models-not-object", tempDir);
    expect(result).toBeNull();
  });
});

describe("defaultDataDir", () => {
  it("resolves to the real committed data/prices directory (contains anthropic.json)", () => {
    const result = defaultDataDir();
    expect(existsSync(path.join(result, "anthropic.json"))).toBe(true);
  });

  it("is idempotent across repeated calls", () => {
    const first = defaultDataDir();
    const second = defaultDataDir();
    expect(second).toBe(first);
  });
});
