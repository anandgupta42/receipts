// SPEC-0035 R3/R5 — the ready-to-paste share intent lines for `aireceipts pr
// --share`. Text-only, no network: the caller (src/pr/index.ts) prints these
// to stderr ONLY after both the artifact push and the comment upsert have
// confirmed ok, so the hint never advertises a receipt whose comment failed
// to post. The canonical artifact link is the one per-receipt datum shared —
// it goes in the separate `url` param, never concatenated into `text`.

// Maintainer-approved verbatim (PR #77 comment) — do not edit. This exact
// string also ships in site/view.html's inline script for the browser-side
// X intent link; test/site-share.test.ts asserts the two stay byte-identical.
export const SHARE_TEXT = "An aireceipts cost receipt — an observable Standard API cost floor, not an invoice.";

/** The X/Twitter and LinkedIn intent URLs for one canonical artifact link — no `utm_*`, no added tracking key. */
export function buildShareTargets(canonicalUrl: string): { x: string; linkedin: string } {
  const x = new URL("https://twitter.com/intent/tweet");
  x.searchParams.set("text", SHARE_TEXT);
  x.searchParams.set("url", canonicalUrl);
  const linkedin = new URL("https://www.linkedin.com/sharing/share-offsite/");
  linkedin.searchParams.set("url", canonicalUrl);
  return { x: x.href, linkedin: linkedin.href };
}

/** The stderr lines printed for `--share` (see src/pr/index.ts for the ordering guard). */
export function buildShareLines(canonicalUrl: string): string[] {
  const targets = buildShareTargets(canonicalUrl);
  return ["share:", `  X:        ${targets.x}`, `  LinkedIn: ${targets.linkedin}`];
}
