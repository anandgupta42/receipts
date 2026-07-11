// SPEC-0080 — landing SEO + AEO: absolute share cards, JSON-LD, crawler files.
// Everything here is static-byte assertion: markup correctness per the OG /
// sitemap / llms.txt formats, honesty gates on structured data (I3), and the
// kill criterion (no new executable scripts, no new page-initiated fetches).
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { describe, expect, it } from "vitest";

const BASE = "https://anandgupta42.github.io/receipts/";
const landing = readFileSync("site/index.html", "utf8");
const samosa = readFileSync("site/samosa.html", "utf8");

describe("SPEC-0080 R1 · landing share URLs are absolute", () => {
  it("og:image / twitter:image / og:url / canonical carry the exact absolute URLs", () => {
    expect(landing).toContain(`<meta property="og:image" content="${BASE}assets/hero-receipt.png">`);
    expect(landing).toContain(`<meta name="twitter:image" content="${BASE}assets/hero-receipt.png">`);
    expect(landing).toContain(`<meta property="og:url" content="${BASE}">`);
    expect(landing).toContain(`<link rel="canonical" href="${BASE}">`);
  });

  it("the OG image asset exists", () => {
    expect(existsSync("site/assets/hero-receipt.png")).toBe(true);
  });
});

describe("SPEC-0080 R2 · samosa share card", () => {
  it("carries the full OG/twitter/canonical tag set, description byte-equal to the lede", () => {
    const lede = /<p class="lede">([^<]+)<\/p>/.exec(samosa)![1];
    expect(samosa).toContain('<meta property="og:title" content="buy me a samosa">');
    expect(samosa).toContain(`<meta property="og:description" content="${lede}">`);
    expect(samosa).toContain(`<meta property="og:image" content="${BASE}assets/samosa-card.jpg">`);
    expect(samosa).toContain(`<meta property="og:url" content="${BASE}samosa.html">`);
    expect(samosa).toContain('<meta name="twitter:card" content="summary_large_image">');
    expect(samosa).toContain(`<meta name="twitter:image" content="${BASE}assets/samosa-card.jpg">`);
    expect(samosa).toContain(`<link rel="canonical" href="${BASE}samosa.html">`);
  });

  it("the card asset exists and stays under 120KB", () => {
    expect(existsSync("site/assets/samosa-card.jpg")).toBe(true);
    expect(statSync("site/assets/samosa-card.jpg").size).toBeLessThanOrEqual(120 * 1024);
  });
});

describe("SPEC-0080 R3 · JSON-LD, facts only", () => {
  const blocks = landing.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g) ?? [];

  it("exactly one ld+json block, valid JSON, SoftwareApplication", () => {
    expect(blocks).toHaveLength(1);
    const data = JSON.parse(/^<script type="application\/ld\+json">([\s\S]*?)<\/script>$/.exec(blocks[0])![1]) as Record<string, unknown>;
    expect(data["@type"]).toBe("SoftwareApplication");
    // Field allowlist: nothing unverifiable from the repo may appear (I3).
    const allowed = new Set(["@context", "@type", "name", "applicationCategory", "operatingSystem", "offers", "license", "url", "codeRepository", "description"]);
    for (const key of Object.keys(data)) {
      expect(allowed.has(key), `unexpected JSON-LD field: ${key}`).toBe(true);
    }
    expect(data).not.toHaveProperty("aggregateRating");
    expect(data).not.toHaveProperty("review");
  });

  it("the JSON-LD description is byte-equal to the meta description", () => {
    const meta = /<meta name="description" content="([^"]+)">/.exec(landing)![1];
    const data = JSON.parse(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(landing)![1]) as { description: string };
    expect(data.description).toBe(meta);
  });
});

describe("SPEC-0080 R4 · sitemap, test-pinned", () => {
  // No robots.txt: a project-Pages site serves under /receipts/, and crawlers
  // only read origin-root /robots.txt — absence defaults to allow-all, which
  // is the intended policy (S6 finding; see the spec's R4).
  it("no robots.txt ships (it would be undiscoverable theater)", () => {
    expect(existsSync("site/robots.txt")).toBe(false);
  });

  it("sitemap.xml lists exactly the landing, samosa, and every docs page — and no <lastmod>", () => {
    const sitemap = readFileSync("site/sitemap.xml", "utf8");
    const listed = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]).sort();
    const docs = readdirSync("site/docs").filter((f) => f.endsWith(".html"));
    const expected = [BASE, `${BASE}samosa.html`, ...docs.map((d) => `${BASE}docs/${d}`)].sort();
    expect(listed).toEqual(expected);
    expect(sitemap).not.toContain("<lastmod>");
  });
});

describe("SPEC-0080 R5 · llms.txt links resolve", () => {
  it("every link resolves to a shipped page or a known host", () => {
    const llms = readFileSync("site/llms.txt", "utf8");
    const links = [...llms.matchAll(/\]\(([^)]+)\)/g)].map((m) => m[1]);
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) {
      if (link.startsWith(BASE)) {
        const rel = link.slice(BASE.length);
        expect(existsSync(`site/${rel === "" ? "index.html" : rel}`), `llms.txt links a missing page: ${link}`).toBe(true);
      } else {
        expect(link.startsWith("https://github.com/anandgupta42/receipts"), `unexpected llms.txt host: ${link}`).toBe(true);
      }
    }
  });
});

describe("SPEC-0080 kill criterion · no new scripts or fetches", () => {
  it("samosa page still has zero scripts and no external src", () => {
    expect(samosa).not.toContain("<script");
    expect(samosa).not.toMatch(/src="https?:\/\//);
  });

  it("the landing has exactly two <script tags total: the copy-button JS and the inert JSON-LD", () => {
    // Total-count gate (S6: an exclusion regex was spoofable by a decoy
    // attribute) — ANY added script tag fails this, whatever its attributes.
    expect(landing.match(/<script/g)).toHaveLength(2);
    expect(landing.match(/<script type="application\/ld\+json">/g)).toHaveLength(1);
  });

  it("the landing initiates no network calls: no fetch/XHR/beacon, no external src", () => {
    expect(landing).not.toContain("fetch(");
    expect(landing).not.toContain("XMLHttpRequest");
    expect(landing).not.toContain("sendBeacon");
    expect(landing).not.toMatch(/src="https?:\/\//);
  });
});
