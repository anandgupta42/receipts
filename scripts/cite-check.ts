#!/usr/bin/env -S node --experimental-strip-types
// Mechanical gate for data/prices/*.json (I2/I3, AGENTS.md): every vendor file
// must be valid JSON in the documented schema, and every price_history row must
// carry a non-empty `sources` array whose entries each have a `url`.
//
// Usage: node --experimental-strip-types scripts/cite-check.ts [files...]
// With no args, checks every data/prices/*.json. Exits 1 on any violation.
//
// TODO(M1+): URL liveness + price-appears-on-page verification (best-effort,
// flag-for-human rather than hard-fail — pricing pages are unstructured).

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

interface PriceSource {
  url: string;
  observed_at?: string;
  excerpt?: string;
}

interface PriceRow {
  input: number;
  output: number;
  input_cached?: number;
  from_date: string;
  to_date?: string | null;
  sources: PriceSource[];
}

const PRICES_DIR = "data/prices";

function fail(file: string, msg: string, errors: string[]): void {
  errors.push(`${file}: ${msg}`);
}

function checkFile(file: string, errors: string[]): void {
  let doc: unknown;
  try {
    doc = JSON.parse(readFileSync(file, "utf8"));
  } catch (e) {
    fail(file, `invalid JSON — ${(e as Error).message}`, errors);
    return;
  }
  const table = doc as { vendor?: unknown; models?: Record<string, { price_history?: unknown }> };
  if (typeof table.vendor !== "string" || !table.vendor) {
    fail(file, `missing "vendor" string`, errors);
  }
  if (!table.models || typeof table.models !== "object") {
    fail(file, `missing "models" object`, errors);
    return;
  }
  for (const [model, entry] of Object.entries(table.models)) {
    const rows = entry?.price_history;
    if (!Array.isArray(rows) || rows.length === 0) {
      fail(file, `${model}: price_history must be a non-empty array`, errors);
      continue;
    }
    rows.forEach((row: Partial<PriceRow>, i: number) => {
      const at = `${model}.price_history[${i}]`;
      if (typeof row.input !== "number" || typeof row.output !== "number") {
        fail(file, `${at}: input/output must be numbers (usd per million tokens)`, errors);
      }
      if (typeof row.from_date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(row.from_date)) {
        fail(file, `${at}: from_date must be YYYY-MM-DD`, errors);
      }
      const sources = row.sources;
      if (!Array.isArray(sources) || sources.length === 0) {
        fail(file, `${at}: sources must be a non-empty array (I3 — no uncited prices)`, errors);
        return;
      }
      sources.forEach((s: Partial<PriceSource>, j: number) => {
        if (typeof s?.url !== "string" || !/^https?:\/\//.test(s.url)) {
          fail(file, `${at}.sources[${j}]: url (http/https) is required`, errors);
        }
      });
    });
  }
}

function main(): void {
  const args = process.argv.slice(2).filter((f) => f.endsWith(".json"));
  const files =
    args.length > 0
      ? args
      : existsSync(PRICES_DIR)
        ? readdirSync(PRICES_DIR)
            .filter((f) => f.endsWith(".json"))
            .map((f) => join(PRICES_DIR, f))
        : [];

  if (files.length === 0) {
    console.log("cite-check: no price tables to check.");
    return;
  }

  const errors: string[] = [];
  for (const file of files) checkFile(file, errors);

  if (errors.length > 0) {
    console.error(`cite-check: ${errors.length} violation(s):`);
    for (const e of errors) console.error(`  - ${e}`);
    process.exit(1);
  }
  console.log(`cite-check: ${files.length} file(s) OK — every price row is cited.`);
}

main();
