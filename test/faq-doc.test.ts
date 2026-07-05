// SPEC-0046 R6 — the FAQ exists, answers stay grounded and short, every
// relative link resolves, and internal-strategy language can never drift in
// (the tripwire is a guard against drift, not a claim of completeness).
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const doc = readFileSync("docs/faq.md", "utf8");

// SPEC-0046 Design — the eight questions, verbatim.
const QUESTIONS = [
  "How is this different from ccusage or my agent's built-in `/usage`?",
  "I'm on a flat-rate subscription — what do the dollar figures mean for me?",
  "Does aireceipts send anything off my machine?",
  "Can I trust the numbers? Could someone fake a receipt?",
  "Why does my receipt show tokens but no dollars?",
  "Why doesn't the receipt match my vendor's invoice?",
  "Why does my Cursor receipt show session totals only?",
  "Who builds this — is it really AI agents?",
];

// SPEC-0046 Design — the canonical link each answer must carry, by question index.
const CANONICAL_LINKS = [
  "trust.md",
  "guide/13-pricing.md",
  "telemetry.md",
  "trust.md",
  "guide/13-pricing.md",
  "guide/13-pricing.md",
  "guide/14-session-attribution.md",
  "docs/internal/harness.md",
];

// Case-insensitive strings that mark internal strategy material. User-facing
// docs never carry these; CI fails if one is ever pasted in.
const TRIPWIRE = ["show hn", "hacker news", "launch window", "gtm", "funnel", "objection", "competitor"];

function tripwireHits(text: string): string[] {
  const lower = text.toLowerCase();
  return TRIPWIRE.filter((t) => lower.includes(t));
}

/** Relative link targets (path part only), excluding absolute/mailto/anchor links. */
function relativeLinks(text: string): string[] {
  return [...text.matchAll(/\]\(([^)]+)\)/g)]
    .map((m) => m[1])
    .filter((href) => !/^(?:https?:|mailto:|#)/iu.test(href))
    .map((href) => href.split("#", 2)[0]);
}

describe("docs/faq.md (SPEC-0046)", () => {
  it("R5: is linked from the README docs section, getting-started, and troubleshooting", () => {
    const readme = readFileSync("README.md", "utf8");
    const docsSection = readme.split(/^## Docs$/m)[1]?.split(/^## /m)[0] ?? "";
    expect(docsSection, "FAQ link must live in the Docs section").toContain("docs/faq.md");
    expect(readFileSync("docs/guide/01-getting-started.md", "utf8")).toContain("../faq.md");
    expect(readFileSync("docs/guide/12-troubleshooting.md", "utf8")).toContain("../faq.md");
  });

  it("R5: states the split with troubleshooting and links it (question-first vs symptom-first)", () => {
    expect(doc).toContain("guide/12-troubleshooting.md");
    expect(doc).toContain("question-first");
    expect(doc).toContain("symptom-first");
  });

  it("R5: is registered in the docs-site nav manifest (inside NAV_SECTIONS, not a comment)", () => {
    const script = readFileSync("scripts/build-docs-site.mjs", "utf8");
    const manifest = script.split("NAV_SECTIONS")[1]?.split("]);")[0] ?? "";
    expect(manifest).toContain('"faq.md"');
  });

  it("R4: carries all eight Design questions, verbatim, as headings", () => {
    for (const q of QUESTIONS) {
      expect(doc).toContain(`## ${q}`);
    }
    const headings = doc.match(/^## /gm) ?? [];
    expect(headings.length).toBe(QUESTIONS.length);
  });

  it("R4: every answer is at most 10 non-empty lines", () => {
    const sections = doc.split(/^## .*$/m).slice(1);
    expect(sections.length).toBe(QUESTIONS.length);
    for (const section of sections) {
      const lines = section.split("\n").filter((l) => l.trim() !== "");
      expect(lines.length, `answer runs long:\n${section.trim().slice(0, 120)}`).toBeLessThanOrEqual(10);
    }
  });

  it("R4: each answer links its Design-named canonical doc", () => {
    const sections = doc.split(/^## .*$/m).slice(1);
    for (const [i, link] of CANONICAL_LINKS.entries()) {
      expect(sections[i], `answer ${i + 1} dropped its canonical link ${link}`).toContain(link);
    }
  });

  it("R6: every relative link resolves to a committed file (docs/ is the base)", () => {
    const links = relativeLinks(doc);
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) {
      expect(existsSync(join("docs", link)), `dead relative link: ${link}`).toBe(true);
    }
  });

  it("R6: links to unpublished areas (docs/internal, data/) are absolute, never relative", () => {
    // The site build rewrites relative .md links to flat basenames; a relative
    // link into an unpublished dir would 404 on the site. Absolute GitHub URLs
    // work on both surfaces.
    for (const link of relativeLinks(doc)) {
      expect(link.includes("internal/"), `relative link into docs/internal: ${link}`).toBe(false);
      expect(link.startsWith("../"), `relative link escaping docs/: ${link}`).toBe(false);
    }
  });

  it("R6: zero internal-strategy tripwire strings", () => {
    expect(tripwireHits(doc)).toEqual([]);
  });

  it("R6 red path: the tripwire scan actually fires on injected strategy text", () => {
    expect(tripwireHits(`${doc}\n\nPrepared for the Show HN launch window.`)).toEqual([
      "show hn",
      "launch window",
    ]);
  });
});
