// SPEC-0077 R6/R7 — the local share step. These tests own the caption templates
// (session + PR, token fallback, floor marker, no repo/title/project), the
// intent-URL hygiene (first-party host, no UTM/tracking, correct encoding), the
// opt-in `--link` caption, and the R6 guarantee: the ONLY subprocess is the
// clipboard tool — no browser launch, no network socket.
import { describe, expect, it, vi } from "vitest";
import type { CardModel } from "../../src/receipt/card.js";
import type { ClipboardCommand } from "../../src/receipt/clipboard.js";
import {
  cardToolCount,
  prCaptionCore,
  runCardShare,
  sessionCaption,
  type CardShareDeps,
} from "../../src/receipt/shareCard.js";

function sessionCard(overrides: Partial<CardModel> = {}): CardModel {
  return {
    scope: "session",
    scopeLabel: "Claude Code · Jun 18 2026",
    totalUsd: 0.18,
    floored: false,
    tokens: 146877,
    modelMix: [{ model: "claude-opus-4-8", tokenShare: 1 }],
    toolRows: [
      { tool: "Bash", usd: 0.05, tokens: 52364, callCount: 3 },
      { tool: "Edit", usd: 0.04, tokens: 40159, callCount: 2 },
      { tool: "(thinking/reply)", usd: 0.03, tokens: 30527, callCount: 4 },
    ],
    sessionCount: 1,
    subagentCount: 0,
    roles: [],
    ...overrides,
  };
}

function prCard(overrides: Partial<CardModel> = {}): CardModel {
  return {
    scope: "pr",
    scopeLabel: "PR #189",
    totalUsd: 3.13,
    floored: false,
    tokens: 900000,
    modelMix: [{ model: "claude-opus-4-8", tokenShare: 1 }],
    toolRows: [{ tool: "Bash", usd: 1.5, tokens: 100000, callCount: 10 }],
    sessionCount: 3,
    subagentCount: 2,
    roles: ["1 orchestrator", "2 builders"],
    ...overrides,
  };
}

/** A deps stub that records printed lines and clipboard attempts; `platform` and clipboard success are injectable. */
function stubDeps(opts: { platform?: NodeJS.Platform; clipboardOk?: boolean } = {}): {
  deps: CardShareDeps;
  lines: string[];
  clipboardCalls: ClipboardCommand[];
} {
  const lines: string[] = [];
  const clipboardCalls: ClipboardCommand[] = [];
  const deps: CardShareDeps = {
    out: (line) => lines.push(line),
    platform: opts.platform ?? "darwin",
    clipboard: (command) => {
      clipboardCalls.push(command);
      return { ok: opts.clipboardOk ?? true };
    },
  };
  return { deps, lines, clipboardCalls };
}

describe("cardToolCount — tool calls excluding the thinking/reply pseudo-row", () => {
  it("sums callCount over real tools only", () => {
    expect(cardToolCount(sessionCard())).toBe(5); // 3 Bash + 2 Edit; thinking/reply excluded
  });
});

describe("SPEC-0077 R7 — session caption template", () => {
  it("is `$<total> · <agent> · <n> tools`, no repo/branch/project/title", () => {
    expect(sessionCaption(sessionCard(), "Claude Code")).toBe("$0.18 · Claude Code · 5 tools");
  });

  it("token fallback replaces `$<total>` when nothing priced (I2)", () => {
    const cap = sessionCaption(sessionCard({ totalUsd: null }), "Claude Code");
    expect(cap).toBe("146,877 tok · Claude Code · 5 tools");
    expect(cap).not.toContain("$");
  });

  it("carries the `≥` floor marker when the total is a lower bound (I2)", () => {
    expect(sessionCaption(sessionCard({ floored: true }), "Claude Code")).toBe("≥ $0.18 · Claude Code · 5 tools");
  });

  it("singularizes a one-tool session", () => {
    const oneTool = sessionCard({ toolRows: [{ tool: "Bash", usd: 0.01, tokens: 10, callCount: 1 }] });
    expect(sessionCaption(oneTool, "Codex")).toBe("$0.18 · Codex · 1 tool");
  });

  it("sanitizes a hostile agent label (no newline injection into the caption)", () => {
    const cap = sessionCaption(sessionCard(), "Claude\nrm -rf /\tCode");
    expect(cap).not.toContain("\n");
    expect(cap).toBe("$0.18 · Claude rm -rf / Code · 5 tools");
  });
});

describe("SPEC-0077 R7 — PR caption template", () => {
  it("is `PR #<n> — $<total> across <n> sessions`, no owner/repo/branch", () => {
    expect(prCaptionCore(prCard(), false)).toBe("PR #189 — $3.13 across 3 sessions");
  });

  it("adds the ` · full receipt ↓` suffix only when a link is present", () => {
    expect(prCaptionCore(prCard(), true)).toBe("PR #189 — $3.13 across 3 sessions · full receipt ↓");
  });

  it("floors the headline and token-fallbacks like the session caption (I2)", () => {
    expect(prCaptionCore(prCard({ floored: true }), false)).toBe("PR #189 — ≥ $3.13 across 3 sessions");
    expect(prCaptionCore(prCard({ totalUsd: null }), false)).toBe("PR #189 — 900,000 tok across 3 sessions");
  });
});

describe("SPEC-0077 R6 — the share step prints caption + intents + drag note", () => {
  it("prints the caption, an X and a LinkedIn intent URL, and the one-drag note", () => {
    const { deps, lines } = stubDeps();
    runCardShare({ model: sessionCard(), imagePath: "card.png", format: "png", agentLabel: "Claude Code" }, deps);
    const text = lines.join("\n");
    expect(text).toContain("caption:  $0.18 · Claude Code · 5 tools");
    expect(text).toContain("X:        https://twitter.com/intent/tweet");
    expect(text).toContain("LinkedIn: https://www.linkedin.com/");
    expect(text).toContain("drag the image in — composers can't attach it for you");
  });

  it("copies the IMAGE to the clipboard (PNG) and reports it — one clipboard payload, caption stays on stdout", () => {
    const { deps, lines, clipboardCalls } = stubDeps({ clipboardOk: true });
    const result = runCardShare({ model: sessionCard(), imagePath: "card.png", format: "png", agentLabel: "Claude Code" }, deps);
    expect(result.clipboardImageCopied).toBe(true);
    expect(clipboardCalls).toHaveLength(1); // the image, and only the image
    expect(lines.join("\n")).toContain("image copied to clipboard");
  });

  it("R6 fallback: clipboard unavailable → image still saved, one-line note, never throws", () => {
    const { deps, lines } = stubDeps({ clipboardOk: false });
    const result = runCardShare({ model: sessionCard(), imagePath: "/out/card.png", format: "png" }, deps);
    expect(result.clipboardImageCopied).toBe(false);
    expect(lines.join("\n")).toContain("clipboard copy unavailable; image saved to /out/card.png");
  });

  it("SVG cards skip the image clipboard copy (no raster payload)", () => {
    const { deps, lines, clipboardCalls } = stubDeps();
    const result = runCardShare({ model: sessionCard(), imagePath: "card.svg", format: "svg" }, deps);
    expect(result.clipboardImageCopied).toBe(false);
    expect(clipboardCalls).toHaveLength(0);
    expect(lines.join("\n")).toContain("PNG-only");
  });
});

describe("SPEC-0077 R6 — no browser launch, no network socket (only the clipboard subprocess)", () => {
  it("the sole subprocess is a clipboard tool; it never opens a URL or a browser", () => {
    const { deps, clipboardCalls } = stubDeps();
    runCardShare(
      { model: prCard(), imagePath: "card.png", format: "png", link: "https://github.com/o/r/pull/189#issuecomment-1" },
      deps,
    );
    expect(clipboardCalls).toHaveLength(1);
    expect(clipboardCalls[0].cmd).toBe("osascript"); // darwin clipboard tool
    expect(clipboardCalls[0].cmd).not.toMatch(/open|xdg-open|start|firefox|chrome|safari/);
    for (const call of clipboardCalls) {
      // The clipboard tool is never handed a URL — it copies the local image only.
      expect(call.args.join(" ")).not.toContain("http");
    }
  });

  it("performs no network fetch", () => {
    const fetchSpy = vi.fn();
    const original = globalThis.fetch;
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    try {
      const { deps } = stubDeps();
      runCardShare({ model: sessionCard(), imagePath: "card.png", format: "png", agentLabel: "Claude Code" }, deps);
    } finally {
      globalThis.fetch = original;
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("SPEC-0077 R6/R7 — intent-URL hygiene (first-party, no tracking)", () => {
  function intentsFrom(lines: string[]): { x: URL; linkedin: URL } {
    const x = lines.find((l) => l.includes("X:"))!.split("X:")[1].trim();
    const linkedin = lines.find((l) => l.includes("LinkedIn:"))!.split("LinkedIn:")[1].trim();
    return { x: new URL(x), linkedin: new URL(linkedin) };
  }

  it("linkless (session): X carries the caption as text, LinkedIn is first-party, no UTM/tracking", () => {
    const { deps, lines } = stubDeps();
    runCardShare({ model: sessionCard(), imagePath: "card.png", format: "png", agentLabel: "Claude Code" }, deps);
    const { x, linkedin } = intentsFrom(lines);
    expect(x.host).toBe("twitter.com");
    expect(linkedin.host).toBe("www.linkedin.com");
    expect(x.searchParams.get("text")).toBe("$0.18 · Claude Code · 5 tools");
    expect(x.searchParams.has("url")).toBe(false); // linkless
    for (const u of [x, linkedin]) {
      expect([...u.searchParams.keys()].some((k) => k.startsWith("utm_"))).toBe(false);
    }
  });

  it("no third-party host and no tracking key ever appears in either intent URL", () => {
    const { deps, lines } = stubDeps();
    runCardShare(
      { model: prCard(), imagePath: "card.png", format: "png", link: "https://github.com/o/r/pull/189#issuecomment-1" },
      deps,
    );
    const { x, linkedin } = intentsFrom(lines);
    expect(["twitter.com", "www.linkedin.com"]).toContain(x.host);
    expect(["twitter.com", "www.linkedin.com"]).toContain(linkedin.host);
    for (const u of [x, linkedin]) {
      for (const key of u.searchParams.keys()) {
        expect(key).not.toMatch(/^utm_|^fbclid|^gclid|ref_src|ref_url/);
      }
    }
    // The permalink rides the intent `url` field (X) / share-offsite (LinkedIn), percent-encoded.
    expect(x.searchParams.get("url")).toBe("https://github.com/o/r/pull/189#issuecomment-1");
    expect(linkedin.searchParams.get("url")).toBe("https://github.com/o/r/pull/189#issuecomment-1");
  });
});

describe("SPEC-0077 R5 — the opt-in link rides the caption, not the image", () => {
  it("the printed caption carries the permalink; result reports linkIncluded", () => {
    const { deps, lines } = stubDeps();
    const result = runCardShare(
      { model: prCard(), imagePath: "card.png", format: "png", link: "https://github.com/o/r/pull/189#issuecomment-1" },
      deps,
    );
    expect(result.linkIncluded).toBe(true);
    expect(lines.join("\n")).toContain("caption:  PR #189 — $3.13 across 3 sessions · full receipt ↓ https://github.com/o/r/pull/189#issuecomment-1");
  });

  it("linkless PR card omits the URL entirely", () => {
    const { deps, lines } = stubDeps();
    const result = runCardShare({ model: prCard(), imagePath: "card.png", format: "png" }, deps);
    expect(result.linkIncluded).toBe(false);
    expect(lines.join("\n")).not.toContain("github.com");
    expect(lines.join("\n")).not.toContain("full receipt");
  });
});
