// SPEC-0001's eval-corpus success criterion: the waste detectors must fire
// on exactly the classes each fixture is designed to trigger — no more, no
// less. This is the FP battery: a single unexpected firing on a fixture
// marked `[]` (clean) fails the whole suite, since a false positive here is
// the product's trust gate breaking. Recall is checked the same way in
// reverse — a fixture's expected classes must all actually fire.
//
// `eval/corpus.json` maps each fixture (source + path) to its expected
// waste-class array. Every entry's expectation was verified against real
// detector output before being committed here, not hand-guessed.
import { fileURLToPath } from "node:url";
import path from "node:path";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const contracts = await import("../src/index.js").catch(() => null);
const hasDetectors =
  typeof contracts?.loadById === "function" &&
  typeof contracts?.detectStuckLoops === "function" &&
  typeof contracts?.detectTrivialSpans === "function";

if (!hasDetectors) {
  console.warn(
    "[BLOCKED] eval-corpus tests skipped: src/index.ts has not exported " +
      "loadById/detectStuckLoops/detectTrivialSpans yet.",
  );
}

interface CorpusEntry {
  source: "claude-code" | "codex" | "cursor" | "gemini";
  path: string;
  expected: string[];
}

interface Corpus {
  entries: CorpusEntry[];
}

const corpus: Corpus = JSON.parse(readFileSync(path.join(repoRoot, "eval/corpus.json"), "utf8"));

describe.skipIf(!hasDetectors)("eval corpus (FP battery)", () => {
  it("has at least 6 entries including at least 2 clean (SPEC-0001 minimum)", () => {
    expect(corpus.entries.length).toBeGreaterThanOrEqual(6);
    const cleanCount = corpus.entries.filter((e) => e.expected.length === 0).length;
    expect(cleanCount).toBeGreaterThanOrEqual(2);
  });

  for (const entry of corpus.entries) {
    it(`${entry.path} fires exactly ${JSON.stringify(entry.expected)} (precision + recall)`, async () => {
      const filePath = path.join(repoRoot, entry.path);
      const session = await contracts!.loadById(entry.source, filePath);
      expect(session, `fixture failed to load: ${entry.path}`).not.toBeNull();

      const actual = new Set<string>();
      const loops = await contracts!.detectStuckLoops(session);
      if (loops.length > 0) {
        actual.add("stuck-loop");
      }
      const trivial = await contracts!.detectTrivialSpans(session);
      if (trivial) {
        actual.add("trivial-spans");
      }

      const expected = new Set(entry.expected);

      // Recall: every expected class must fire.
      for (const cls of expected) {
        expect(actual.has(cls), `expected "${cls}" to fire on ${entry.path} but it did not`).toBe(true);
      }
      // Precision: nothing beyond what's expected may fire. A single
      // unexpected firing (e.g. a clean fixture tripping a detector) fails
      // this — that's the trust gate.
      for (const cls of actual) {
        expect(expected.has(cls), `unexpected "${cls}" fired on ${entry.path} (expected ${JSON.stringify(entry.expected)})`).toBe(
          true,
        );
      }
    });
  }
});
