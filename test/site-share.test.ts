// SPEC-0035 — site/view.html's share chrome (R1-R4) plus the kill criterion.
// No jsdom dependency exists in this repo, so the inline <script> is extracted
// and executed under Node's built-in `vm` module against a minimal hand-rolled
// document/window/fetch/navigator stub — enough to drive the pure parsing and
// share-target logic without a real browser.
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { describe, expect, it } from "vitest";
import { SHARE_TEXT as CLI_SHARE_TEXT } from "../src/pr/share.js";

const html = readFileSync("site/view.html", "utf8");

const scriptMatch = /<script>\n([\s\S]*?)\n<\/script>/.exec(html);
if (scriptMatch === null) {
  throw new Error("site/view.html: inline <script> block not found");
}
const scriptSrc = scriptMatch[1];

interface StubElem {
  id: string;
  hidden: boolean;
  className: string;
  textContent: string;
  href: string;
  srcdoc: string;
  children: StubElem[];
  listeners: Record<string, Array<() => void>>;
  appendChild(child: StubElem): void;
  addEventListener(type: string, cb: () => void): void;
}

function makeElem(id: string, hidden = false): StubElem {
  return {
    id,
    hidden,
    className: "",
    textContent: "",
    href: "",
    srcdoc: "",
    children: [],
    listeners: {},
    appendChild(child) {
      this.children.push(child);
    },
    addEventListener(type, cb) {
      (this.listeners[type] ??= []).push(cb);
    },
  };
}

type FetchStub = (url: string) => Promise<{ ok: boolean; status: number; text: () => Promise<string> }>;

/** Run the extracted inline script against a fresh stub DOM; returns the live element map. */
function runViewer(search: string, fetchImpl: FetchStub) {
  const elems = new Map<string, StubElem>([
    ["status", makeElem("status")],
    ["frame", makeElem("frame", true)],
    ["provenance", makeElem("provenance")],
    ["share", makeElem("share", true)],
    ["share-x", makeElem("share-x")],
    ["share-linkedin", makeElem("share-linkedin")],
    ["share-copy", makeElem("share-copy")],
  ]);
  const document = {
    getElementById: (id: string) => elems.get(id) ?? null,
    createElement: (tag: string) => makeElem(tag),
  };
  const window = {
    location: { origin: "https://anandgupta42.github.io", pathname: "/receipts/view.html", search },
  };
  const context = vm.createContext({
    document,
    window,
    navigator: { clipboard: { writeText: () => Promise.resolve() } },
    fetch: fetchImpl,
    URL,
    URLSearchParams,
    setTimeout,
    console,
  });
  vm.runInContext(scriptSrc, context);
  return elems;
}

const ARTIFACT_URL = "https://raw.githubusercontent.com/o/r/refs/heads/aireceipts/artifacts/pr-7.html";
const ok200 = async (): Promise<{ ok: boolean; status: number; text: () => Promise<string> }> => ({
  ok: true,
  status: 200,
  text: async () => "<p>fixture</p>",
});
async function flush(): Promise<void> {
  await new Promise((r) => setTimeout(r, 0));
}

describe("SPEC-0035 R1 — capturing artifact-path parser", () => {
  it("accepts a well-formed refs/heads/aireceipts/artifacts raw URL and fetches the canonical form", async () => {
    let fetched = "";
    const elems = runViewer(`?src=${encodeURIComponent(ARTIFACT_URL)}`, async (u) => {
      fetched = u;
      return ok200();
    });
    await flush();
    expect(fetched).toBe(ARTIFACT_URL);
    expect(elems.get("share")!.hidden).toBe(false);
  });

  it("normalizes a github.com blob URL to the same canonical raw form", async () => {
    let fetched = "";
    const blob = "https://github.com/o/r/blob/refs/heads/aireceipts/artifacts/pr-7.html";
    const elems = runViewer(`?src=${encodeURIComponent(blob)}`, async (u) => {
      fetched = u;
      return ok200();
    });
    await flush();
    expect(fetched).toBe(ARTIFACT_URL);
    expect(elems.get("share")!.hidden).toBe(false);
  });

  it("rejects the old ref-optional shorthand (no refs/heads/ prefix) — R1's exact hardening target", async () => {
    let fetchCalled = false;
    const shorthand = "https://raw.githubusercontent.com/o/r/aireceipts/artifacts/pr-7.html";
    const elems = runViewer(`?src=${encodeURIComponent(shorthand)}`, async () => {
      fetchCalled = true;
      return ok200();
    });
    expect(fetchCalled).toBe(false);
    expect(elems.get("status")!.className).toBe("msg error");
    expect(elems.get("share")!.hidden).toBe(true);
  });

  it("rejects a smuggled delimiter in the owner segment (encoded slash falls outside the slug charset)", async () => {
    let fetchCalled = false;
    const smuggled = "https://raw.githubusercontent.com/o%2Fevil/r/refs/heads/aireceipts/artifacts/pr-7.html";
    runViewer(`?src=${encodeURIComponent(smuggled)}`, async () => {
      fetchCalled = true;
      return ok200();
    });
    expect(fetchCalled).toBe(false);
  });

  it("rejects a query string or fragment riding along on the artifact URL (no ?src= echo-back)", async () => {
    let fetchCalled = false;
    runViewer(`?src=${encodeURIComponent(ARTIFACT_URL + "?evil=1")}`, async () => {
      fetchCalled = true;
      return ok200();
    });
    expect(fetchCalled).toBe(false);
  });

  it("rejects a host outside the allowlist", async () => {
    let fetchCalled = false;
    const evil = "https://evil.example.com/o/r/refs/heads/aireceipts/artifacts/pr-7.html";
    runViewer(`?src=${encodeURIComponent(evil)}`, async () => {
      fetchCalled = true;
      return ok200();
    });
    expect(fetchCalled).toBe(false);
  });

  it("rejects a non-artifact filename", async () => {
    let fetchCalled = false;
    const bad = "https://raw.githubusercontent.com/o/r/refs/heads/aireceipts/artifacts/not-an-artifact.html";
    runViewer(`?src=${encodeURIComponent(bad)}`, async () => {
      fetchCalled = true;
      return ok200();
    });
    expect(fetchCalled).toBe(false);
  });

  it("rejects userinfo smuggled into the URL (S5)", async () => {
    let fetchCalled = false;
    const evil = "https://user:pass@raw.githubusercontent.com/o/r/refs/heads/aireceipts/artifacts/pr-7.html";
    runViewer(`?src=${encodeURIComponent(evil)}`, async () => {
      fetchCalled = true;
      return ok200();
    });
    expect(fetchCalled).toBe(false);
  });

  it("rejects a non-default port (S5)", async () => {
    let fetchCalled = false;
    const evil = "https://raw.githubusercontent.com:444/o/r/refs/heads/aireceipts/artifacts/pr-7.html";
    runViewer(`?src=${encodeURIComponent(evil)}`, async () => {
      fetchCalled = true;
      return ok200();
    });
    expect(fetchCalled).toBe(false);
  });

  it("rejects a dot-segment climb that only NORMALIZES into an artifact URL (S5)", async () => {
    let fetchCalled = false;
    const climb = "https://raw.githubusercontent.com/o/r/refs/heads/aireceipts/artifacts/pr-7.html/%2e%2e/pr-8.html";
    runViewer(`?src=${encodeURIComponent(climb)}`, async () => {
      fetchCalled = true;
      return ok200();
    });
    expect(fetchCalled).toBe(false);
  });

  it("rejects embedded control characters stripped away by URL parsing (S5 round-trip check)", async () => {
    let fetchCalled = false;
    runViewer(`?src=${encodeURIComponent(ARTIFACT_URL.slice(0, 30) + "\n" + ARTIFACT_URL.slice(30))}`, async () => {
      fetchCalled = true;
      return ok200();
    });
    expect(fetchCalled).toBe(false);
  });

  it("missing ?src= fails without ever calling fetch", () => {
    let fetchCalled = false;
    const elems = runViewer("", async () => {
      fetchCalled = true;
      return ok200();
    });
    expect(fetchCalled).toBe(false);
    expect(elems.get("status")!.className).toBe("msg error");
  });
});

describe("SPEC-0035 R2 — load-gated share chrome", () => {
  it("the share span is `hidden` in the static markup (never shown before JS runs)", () => {
    expect(html).toMatch(/<span id="share" hidden>/);
  });

  it("stays hidden on a parse failure (no share affordance on an unresolved receipt)", () => {
    const elems = runViewer("?src=not-a-url", async () => ok200());
    expect(elems.get("share")!.hidden).toBe(true);
  });

  it("stays hidden when the fetch resolves non-ok (private repo / deleted artifact)", async () => {
    const elems = runViewer(`?src=${encodeURIComponent(ARTIFACT_URL)}`, async () => ({
      ok: false,
      status: 404,
      text: async () => "",
    }));
    await flush();
    expect(elems.get("share")!.hidden).toBe(true);
  });

  it("stays hidden when the fetch rejects outright (network error)", async () => {
    const elems = runViewer(`?src=${encodeURIComponent(ARTIFACT_URL)}`, async () => {
      throw new Error("network down");
    });
    await flush();
    expect(elems.get("share")!.hidden).toBe(true);
  });

  it("is revealed ONLY inside the success branch, after srcdoc is set", async () => {
    const elems = runViewer(`?src=${encodeURIComponent(ARTIFACT_URL)}`, async () => ok200());
    await flush();
    expect(elems.get("frame")!.hidden).toBe(false);
    expect(elems.get("share")!.hidden).toBe(false);
  });
});

describe("SPEC-0035 S5 — srcdoc CSP confinement (hostile artifact cannot load resources)", () => {
  const CSP_META = "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'\">";

  it("a hostile artifact with a tracking pixel gets the CSP injected AHEAD of its content", async () => {
    const hostile = '<img src="https://evil.example/pixel"><p>forged receipt</p>';
    const elems = runViewer(`?src=${encodeURIComponent(ARTIFACT_URL)}`, async () => ({
      ok: true,
      status: 200,
      text: async () => hostile,
    }));
    await flush();
    const srcdoc = elems.get("frame")!.srcdoc;
    expect(srcdoc.startsWith(CSP_META)).toBe(true);
    expect(srcdoc.indexOf(CSP_META)).toBeLessThan(srcdoc.indexOf("evil.example"));
  });

  it("a legitimate artifact keeps standards mode: CSP lands AFTER the doctype", async () => {
    const legit = "<!doctype html>\n<html><head><style>p{color:#000}</style></head><body><p>receipt</p></body></html>";
    const elems = runViewer(`?src=${encodeURIComponent(ARTIFACT_URL)}`, async () => ({
      ok: true,
      status: 200,
      text: async () => legit,
    }));
    await flush();
    const srcdoc = elems.get("frame")!.srcdoc;
    expect(srcdoc.startsWith("<!doctype html>" + CSP_META)).toBe(true);
    expect(srcdoc).toContain("<style>p{color:#000}</style>"); // inline styles survive (style-src 'unsafe-inline')
  });

  it("the CSP forbids every load class and allows only inline styles", () => {
    const m = /var FRAME_CSP = "(.*)";/.exec(scriptSrc);
    expect(m, "FRAME_CSP declaration not found").not.toBeNull();
    const csp = m![1].replace(/\\"/g, '"');
    for (const directive of ["default-src 'none'", "style-src 'unsafe-inline'", "base-uri 'none'", "form-action 'none'"]) {
      expect(csp).toContain(directive);
    }
  });
});

describe("SPEC-0035 R3 — intent-URL share targets", () => {
  it("X intent: fixed maintainer-approved text, canonical url in a separate param, no tracking keys", async () => {
    const elems = runViewer(`?src=${encodeURIComponent(ARTIFACT_URL)}`, async () => ok200());
    await flush();
    const href = elems.get("share-x")!.href;
    const u = new URL(href);
    expect(u.origin + u.pathname).toBe("https://twitter.com/intent/tweet");
    expect(u.searchParams.get("text")).toBe("An aireceipts cost receipt — an observable Standard API cost floor, not an invoice.");
    expect(u.searchParams.get("url")).toBe(
      "https://anandgupta42.github.io/receipts/view.html?src=" + encodeURIComponent(ARTIFACT_URL),
    );
    expect([...u.searchParams.keys()].some((k) => k.startsWith("utm_"))).toBe(false);
  });

  it("LinkedIn share: url param ONLY — no text field, no tracking keys", async () => {
    const elems = runViewer(`?src=${encodeURIComponent(ARTIFACT_URL)}`, async () => ok200());
    await flush();
    const href = elems.get("share-linkedin")!.href;
    const u = new URL(href);
    expect(u.origin + u.pathname).toBe("https://www.linkedin.com/sharing/share-offsite/");
    expect(u.searchParams.get("url")).toBe(
      "https://anandgupta42.github.io/receipts/view.html?src=" + encodeURIComponent(ARTIFACT_URL),
    );
    expect(u.searchParams.has("text")).toBe(false);
    expect([...u.searchParams.keys()].some((k) => k.startsWith("utm_"))).toBe(false);
  });

  it("SHARE_TEXT in view.html is byte-identical to src/pr/share.ts's constant (CLI + browser ship the same copy)", () => {
    const m = /var SHARE_TEXT = "([^"]*)";/.exec(scriptSrc);
    expect(m, "SHARE_TEXT declaration not found in site/view.html").not.toBeNull();
    expect(m![1]).toBe(CLI_SHARE_TEXT);
    expect(m![1]).toBe("An aireceipts cost receipt — an observable Standard API cost floor, not an invoice.");
  });
});

describe("SPEC-0035 R4 — static OG/Twitter Card metadata", () => {
  it("declares the required og: and twitter: meta tags", () => {
    for (const tag of ["og:type", "og:title", "og:description", "og:image", "twitter:card", "twitter:title", "twitter:description", "twitter:image"]) {
      expect(html, `missing meta tag ${tag}`).toMatch(new RegExp(`(?:property|name)="${tag}"`));
    }
  });

  it("og:image/twitter:image point at one static, same-origin brand card — no per-receipt image", () => {
    const ogImage = /property="og:image" content="([^"]+)"/.exec(html)?.[1];
    const twImage = /name="twitter:image" content="([^"]+)"/.exec(html)?.[1];
    expect(ogImage).toBe("https://anandgupta42.github.io/receipts/og-card.png");
    expect(twImage).toBe(ogImage);
  });

  it("intentionally omits og:url (one static file serves every receipt via ?src=)", () => {
    expect(html).not.toMatch(/property="og:url"/);
  });
});

describe("SPEC-0035 kill criterion — zero third-party RESOURCE loads (click destinations may be external)", () => {
  it("no <script>/<img>/<link>/<iframe> tag loads a resource from an external src/href", () => {
    const resourceTags = [...html.matchAll(/<(script|img|link|source|iframe)\b[^>]*>/gi)];
    expect(resourceTags.length).toBeGreaterThan(0); // sanity: the regex actually matches this file's tags
    for (const [tag] of resourceTags) {
      const attr = /\s(?:src|href)="([^"]*)"/i.exec(tag);
      if (attr === null) continue; // inline <script>, and the #frame iframe (srcdoc is set via JS, not a static src)
      expect(attr[1], `resource-loading tag found: ${tag}`).toMatch(/^#/);
    }
  });

  it("the only network call in the script is the artifact fetch, targeting the validated canonical URL", () => {
    const fetchCalls = [...scriptSrc.matchAll(/\bfetch\(/g)];
    expect(fetchCalls).toHaveLength(1);
    expect(scriptSrc).toContain("fetch(canonical.href)");
  });

  it("no analytics/tracking script is referenced anywhere in the file", () => {
    for (const needle of ["google-analytics", "gtag(", "googletagmanager", "plausible", "hotjar", "segment.io", "mixpanel", "fullstory", "utm_"]) {
      expect(html.toLowerCase()).not.toContain(needle.toLowerCase());
    }
  });
});
