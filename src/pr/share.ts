// SPEC-0035 R3/R5 — the ready-to-paste share intent lines for `aireceipts pr
// --share`. Text-only, no network: the caller (src/pr/index.ts) prints these
// to stderr ONLY after both the artifact push and the comment upsert have
// confirmed ok, so the hint never advertises a receipt whose comment failed
// to post. The canonical artifact link is the one per-receipt datum shared —
// it goes in the separate `url` param, never concatenated into `text`.

// Maintainer-approved verbatim (PR #77 comment) — do not edit. This exact
// string also ships in site/view.html's inline script for the browser-side
// X intent link; test/site-share.test.ts asserts the two stay byte-identical.
export const SHARE_TEXT = "An aireceipts cost receipt — what the AI agents actually cost.";

/**
 * The one place X/Twitter + LinkedIn web-intent URLs are built (SPEC-0035 R3
 * rules: first-party host only, no `utm_*`, no added tracking key). Both the PR
 * `--share` artifact link and the SPEC-0077 shareable card route through here.
 *
 * `text` prefills the composer (X always; LinkedIn's text-prefill compose when
 * no `url` accompanies it). `url` prefills the separate link field: X's `url`
 * param, LinkedIn's `share-offsite` (the SPEC-0035 shape). When no `url` is
 * given (a linkless card), LinkedIn uses its first-party `feed` compose so the
 * caption still prefills — never a third-party host, never a tracking param.
 */
export function buildIntentTargets(input: { text: string; url?: string }): { x: string; linkedin: string } {
  const x = new URL("https://twitter.com/intent/tweet");
  x.searchParams.set("text", input.text);
  if (input.url !== undefined && input.url !== "") {
    x.searchParams.set("url", input.url);
  }
  let linkedin: URL;
  if (input.url !== undefined && input.url !== "") {
    linkedin = new URL("https://www.linkedin.com/sharing/share-offsite/");
    linkedin.searchParams.set("url", input.url);
  } else {
    linkedin = new URL("https://www.linkedin.com/feed/");
    linkedin.searchParams.set("shareActive", "true");
    linkedin.searchParams.set("text", input.text);
  }
  return { x: x.href, linkedin: linkedin.href };
}

/** The X/Twitter and LinkedIn intent URLs for one canonical artifact link — no `utm_*`, no added tracking key. */
export function buildShareTargets(canonicalUrl: string): { x: string; linkedin: string } {
  return buildIntentTargets({ text: SHARE_TEXT, url: canonicalUrl });
}

/** The stderr lines printed for `--share` (see src/pr/index.ts for the ordering guard). */
export function buildShareLines(canonicalUrl: string): string[] {
  const targets = buildShareTargets(canonicalUrl);
  return ["share:", `  X:        ${targets.x}`, `  LinkedIn: ${targets.linkedin}`];
}
