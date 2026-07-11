// SPEC-0079 — the samosa story page contract and the own-surface link pins.
// R1: the page is self-contained (zero scripts, embedded photo, exactly two
// external hrefs — Wikipedia and the Ko-fi jar, ask-last) and carries the
// Design-section copy verbatim. R3: FUNDING.yml offers the Ko-fi row. R4: the
// landing/viewer/docs surfaces keep their samosa.html links — a README rework
// once silently dropped the link, so these are pinned, not trusted.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const page = readFileSync("site/samosa.html", "utf8");

const KOFI = 'href="https://ko-fi.com/anandgupta42"';
const WIKI = 'href="https://en.wikipedia.org/wiki/Samosa"';

describe("SPEC-0079 R1 · the story page contract", () => {
  it("has zero <script> tags and no analytics hooks", () => {
    expect(page).not.toContain("<script");
    expect(page).not.toContain("analytics");
  });

  it("has exactly two external hrefs: Wikipedia and the Ko-fi jar", () => {
    const external = page.match(/href="https?:\/\//g) ?? [];
    expect(external).toHaveLength(2);
    expect(page).toContain(WIKI);
    expect(page).toContain(KOFI);
  });

  it("embeds the image as a data URI with a descriptive alt — no external image fetch", () => {
    expect(page).toContain('src="data:image/jpeg;base64,');
    expect(page).toContain(
      'alt="Golden samosas on a plate, one broken open to show the spiced potato and pea filling, with green and tamarind chutneys"',
    );
    expect(page).not.toMatch(/src="https?:\/\//);
  });

  it("labels the image honestly: AI-rendered, no fabricated photo credit", () => {
    expect(page).toContain("rendered by AI &mdash; the real ones get eaten too fast to photograph");
    expect(page).not.toContain("photo:");
  });

  it("carries the Design copy verbatim", () => {
    expect(page).toContain(
      "Every open-source project asks you to buy the maintainer a coffee. Not this one. I want a samosa.",
    );
    expect(page).toContain("and I genuinely believe it is the best snack ever made");
    expect(page).toContain("This page exists to spread samosa awareness.");
    // The fact block teaches a stranger what a samosa is.
    expect(page).toContain("the shell");
    expect(page).toContain("the filling");
    expect(page).toContain("the dip");
  });

  it("asks last: the Ko-fi link is the final href before the relative back link", () => {
    expect(page.indexOf(KOFI)).toBeGreaterThan(page.indexOf(WIKI));
    expect(page.indexOf('href="index.html"')).toBeGreaterThan(page.indexOf(KOFI));
    expect(page.lastIndexOf('href="https')).toBe(page.indexOf(KOFI));
  });

  it("the Unicode-emoji story is gone (maintainer directive)", () => {
    expect(page).not.toContain("Unicode");
    expect(page).not.toContain("\u{1F95F}");
  });
});

describe("SPEC-0079 R3 · FUNDING.yml offers the tip jar", () => {
  it("carries the ko_fi row alongside the samosa-page custom entry", () => {
    const funding = readFileSync(".github/FUNDING.yml", "utf8");
    expect(funding).toContain("ko_fi: anandgupta42");
    expect(funding).toContain('custom: ["https://anandgupta42.github.io/receipts/samosa.html"]');
  });
});

describe("SPEC-0079 R4 · own-surface samosa links are pinned", () => {
  const SURFACES = [
    "site/index.html",
    "site/view.html",
    "scripts/build-docs-site.mjs",
    "site/docs/index.html",
  ];

  it.each(SURFACES)("%s keeps its samosa.html link", (file) => {
    const html = readFileSync(file, "utf8");
    expect(html).toMatch(/href="(\.\.\/)?samosa\.html"/);
  });
});
