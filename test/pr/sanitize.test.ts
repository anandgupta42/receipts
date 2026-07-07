// SPEC-0066 R2/R3 — the injection corpus pinning `deserializePrReceipt`
// (reject malformed/hostile payload shapes) and `sanitizePrReceiptPayload`
// (neutralize every injection vector that DOES pass validation) against the
// scenarios in SPEC-0066's test matrix: fence breakout, `<details>`/`<script>`
// injection, `<img onerror>`, Markdown-link injection, `NaN`/`Infinity`,
// unknown extra field, oversized string.
import { describe, expect, it } from "vitest";
import {
  deserializePrReceipt,
  sanitizePrReceiptPayload,
  MAX_PAYLOAD_STRING_LENGTH,
  SANITIZED_FIELD_CAP,
} from "../../src/pr/sanitize.js";
import { PR_RECEIPT_SCHEMA_VERSION, type PrReceiptPayload } from "../../src/pr/payloadTypes.js";
import { renderPrBody } from "../../src/pr/body.js";
import type { StuckLoopWasteLine, TrivialSpansWasteLine } from "../../src/receipt/model.js";

const emptyTokens = () => ({ input: 0, output: 0, cacheRead: 0, cacheCreation: 0, total: 0 });

function basePayload(overrides: Partial<PrReceiptPayload> = {}): PrReceiptPayload {
  return {
    schemaVersion: PR_RECEIPT_SCHEMA_VERSION,
    bodyInput: { contributors: [], excludedCount: 0 },
    extras: {},
    ...overrides,
  };
}

describe("deserializePrReceipt", () => {
  it("accepts a clean, minimal payload", () => {
    const result = deserializePrReceipt(JSON.stringify(basePayload()));
    expect(result.ok).toBe(true);
  });

  it("accepts a clean, fully-populated payload", () => {
    const payload = basePayload({
      bodyInput: {
        contributors: [
          {
            role: "builder",
            sessionId: "abc123",
            slice: { kind: "slice", startTurn: 0, endTurn: 3, turnCount: 4 },
            modelMix: [{ model: "claude-opus-4-8", tokens: emptyTokens(), tokenShare: 1, usd: 1.5 }],
            usd: 1.5,
            tokens: emptyTokens(),
            subagents: [],
          },
        ],
        excludedCount: 0,
      },
      extras: {
        details: [{ label: "builder — abc123", row: ["builder", "abc123", "full"], text: "receipt text" }],
        handoff: {
          wasteLines: [
            {
              kind: "stuck-loop",
              tool: "Bash",
              runLength: 3,
              usd: 0.1,
              tokens: emptyTokens(),
              wallClockMs: 1000,
              turnIndices: [1, 2, 3],
            },
          ],
          sessionCount: 1,
          turnCount: 4,
        },
        artifactLink: { fileName: "receipt.png", url: "https://example.com/receipt.png" },
      },
    });
    const result = deserializePrReceipt(JSON.stringify(payload));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.payload).toEqual(payload);
    }
  });

  it("rejects invalid JSON without throwing", () => {
    expect(() => deserializePrReceipt("{not json")).not.toThrow();
    const result = deserializePrReceipt("{not json");
    expect(result.ok).toBe(false);
  });

  it("rejects an unknown schemaVersion", () => {
    const raw = JSON.stringify({ ...basePayload(), schemaVersion: 999 });
    expect(deserializePrReceipt(raw).ok).toBe(false);
  });

  it("rejects an unknown top-level field", () => {
    const raw = JSON.stringify({ ...basePayload(), extraField: "smuggled" });
    expect(deserializePrReceipt(raw).ok).toBe(false);
  });

  it("rejects an unknown nested field", () => {
    const payload = basePayload({ extras: { details: [{ label: "x", row: [], text: "x", evilField: "smuggled" } as never] } });
    expect(deserializePrReceipt(JSON.stringify(payload)).ok).toBe(false);
  });

  it("rejects a non-finite number reachable through a JSON literal (1e400 parses to Infinity)", () => {
    const raw = `{"schemaVersion":1,"bodyInput":{"contributors":[],"excludedCount":1e400},"extras":{}}`;
    expect(JSON.parse(raw).bodyInput.excludedCount).toBe(Infinity); // sanity: valid JSON syntax, non-finite value
    const result = deserializePrReceipt(raw);
    expect(result.ok).toBe(false);
  });

  it("rejects an oversized string", () => {
    const payload = basePayload({
      extras: { details: [{ label: "x", row: [], text: "a".repeat(MAX_PAYLOAD_STRING_LENGTH + 1) }] },
    });
    expect(deserializePrReceipt(JSON.stringify(payload)).ok).toBe(false);
  });

  it("never throws regardless of input shape", () => {
    const hostileInputs = ["null", "42", '"a string"', "[]", "{}", "", "   ", "{{{"];
    for (const input of hostileInputs) {
      expect(() => deserializePrReceipt(input)).not.toThrow();
    }
  });
});

describe("sanitizePrReceiptPayload", () => {
  it("neutralizes a code-fence breakout in DetailReceipt.text", () => {
    const payload = basePayload({
      extras: { details: [{ label: "x", row: [], text: "before\n```\nmalicious content\n```\nafter" }] },
    });
    const sanitized = sanitizePrReceiptPayload(payload);
    expect(sanitized.extras.details![0].text).not.toContain("```");
    // the visible characters survive — only the fence's ability to parse is destroyed
    expect(sanitized.extras.details![0].text.replace(/\u200B/g, "")).toContain("```");
  });

  it("neutralizes a tilde-fence breakout", () => {
    const payload = basePayload({ extras: { details: [{ label: "x", row: [], text: "~~~\nbreakout\n~~~" }] } });
    const sanitized = sanitizePrReceiptPayload(payload);
    expect(sanitized.extras.details![0].text).not.toContain("~~~");
  });

  it("neutralizes a <details> injection", () => {
    const payload = basePayload({
      extras: { details: [{ label: "<details><summary>click</summary>hidden</details>", row: [], text: "x" }] },
    });
    const sanitized = sanitizePrReceiptPayload(payload);
    expect(sanitized.extras.details![0].label).not.toContain("<details>");
    expect(sanitized.extras.details![0].label).not.toContain("<");
    expect(sanitized.extras.details![0].label).toContain("&lt;details&gt;");
  });

  it("neutralizes <script> in a live-markdown field, keeps it literal (inert) in fenced text", () => {
    const payload = basePayload({
      extras: { details: [{ label: "<script>alert(1)</script>", row: [], text: "<script>alert(1)</script>" }] },
    });
    const sanitized = sanitizePrReceiptPayload(payload);
    // label renders as a live heading → HTML neutralized
    expect(sanitized.extras.details![0].label).not.toContain("<script>");
    expect(sanitized.extras.details![0].label).toContain("&lt;script&gt;");
    // text renders INSIDE a ``` fence (markdown inert) → kept literal, not corrupted
    expect(sanitized.extras.details![0].text).toBe("<script>alert(1)</script>");
  });

  it("neutralizes an <img onerror> injection", () => {
    const payload = basePayload({
      extras: { details: [{ label: "x", row: ['<img src=x onerror="alert(1)">'], text: "x" }] },
    });
    const sanitized = sanitizePrReceiptPayload(payload);
    expect(sanitized.extras.details![0].row[0]).not.toContain("<img");
    expect(sanitized.extras.details![0].row[0]).toContain("&lt;img");
  });

  it("defangs a Markdown link, dropping the URL", () => {
    const payload = basePayload({
      extras: { details: [{ label: "[click me](javascript:alert(1))", row: [], text: "x" }] },
    });
    const sanitized = sanitizePrReceiptPayload(payload);
    expect(sanitized.extras.details![0].label).not.toContain("javascript:");
    expect(sanitized.extras.details![0].label).not.toContain("(");
    expect(sanitized.extras.details![0].label).not.toContain("[");
    expect(sanitized.extras.details![0].label).toBe("click me");
  });

  it("neutralizes a contributor model name carrying an injection", () => {
    const payload = basePayload({
      bodyInput: {
        contributors: [
          {
            role: "builder",
            sessionId: "abc123",
            slice: { kind: "full", startTurn: 0, endTurn: 0, turnCount: 1, label: "full" },
            modelMix: [{ model: "<script>alert(1)</script>", tokens: emptyTokens(), tokenShare: 1, usd: null }],
            usd: null,
            tokens: emptyTokens(),
            subagents: [],
          },
        ],
        excludedCount: 0,
      },
    });
    const sanitized = sanitizePrReceiptPayload(payload);
    expect(sanitized.bodyInput.contributors[0].modelMix[0].model).not.toContain("<script>");
  });

  it("neutralizes waste-line tool/cheaperModel strings", () => {
    const payload = basePayload({
      extras: {
        handoff: {
          wasteLines: [
            {
              kind: "stuck-loop",
              tool: "<img src=x onerror=alert(1)>",
              runLength: 2,
              usd: null,
              tokens: emptyTokens(),
              wallClockMs: null,
              turnIndices: [1, 2],
            },
            {
              kind: "trivial-spans",
              eligibleTurnCount: 2,
              usd: 0.01,
              tokens: emptyTokens(),
              cheaperModel: "[cheap](javascript:alert(1))",
            },
          ],
          sessionCount: 1,
          turnCount: 2,
        },
      },
    });
    const sanitized = sanitizePrReceiptPayload(payload);
    const wasteLines = sanitized.extras.handoff!.wasteLines;
    const stuckLoop = wasteLines[0] as StuckLoopWasteLine;
    const trivialSpans = wasteLines[1] as TrivialSpansWasteLine;
    expect(stuckLoop.tool).not.toContain("<img");
    expect(trivialSpans.cheaperModel).not.toContain("javascript:");
  });

  it("drops the artifact link entirely when its url is not https (a link target can't be text-escaped)", () => {
    const payload = basePayload({
      extras: { artifactLink: { fileName: "pr-1.html", url: "javascript:alert(1)" } },
    });
    const sanitized = sanitizePrReceiptPayload(payload);
    expect(sanitized.extras.artifactLink).toBeUndefined();
  });

  it("keeps a safe https artifact link and escapes a link-breakout in its fileName", () => {
    const payload = basePayload({
      extras: {
        artifactLink: {
          fileName: "x](https://evil.example) [ok",
          url: "https://anandgupta42.github.io/receipts/view.html?x=1",
        },
      },
    });
    const sanitized = sanitizePrReceiptPayload(payload);
    expect(sanitized.extras.artifactLink).toBeDefined();
    expect(sanitized.extras.artifactLink!.url).toBe("https://anandgupta42.github.io/receipts/view.html?x=1");
    // the fileName's brackets are escaped, so it can't close the link text and inject its own link
    expect(sanitized.extras.artifactLink!.fileName).toContain("\\]");
    expect(sanitized.extras.artifactLink!.fileName).toContain("\\[");
  });

  it("length-caps an oversized field", () => {
    const payload = basePayload({
      bodyInput: {
        contributors: [
          {
            role: "builder",
            sessionId: "abc123",
            slice: { kind: "full", startTurn: 0, endTurn: 0, turnCount: 1, label: "full" },
            modelMix: [{ model: "m".repeat(SANITIZED_FIELD_CAP * 2), tokens: emptyTokens(), tokenShare: 1, usd: null }],
            usd: null,
            tokens: emptyTokens(),
            subagents: [],
          },
        ],
        excludedCount: 0,
      },
    });
    const sanitized = sanitizePrReceiptPayload(payload);
    expect(sanitized.bodyInput.contributors[0].modelMix[0].model.length).toBeLessThanOrEqual(SANITIZED_FIELD_CAP);
  });

  it("does not mutate the input payload", () => {
    const payload = basePayload({ extras: { details: [{ label: "<b>x</b>", row: [], text: "x" }] } });
    const before = JSON.parse(JSON.stringify(payload));
    sanitizePrReceiptPayload(payload);
    expect(payload).toEqual(before);
  });

  it("round-trips a clean payload unchanged", () => {
    const payload = basePayload({
      bodyInput: {
        contributors: [
          {
            role: "builder",
            sessionId: "abc123",
            slice: { kind: "slice", startTurn: 0, endTurn: 3, turnCount: 4 },
            modelMix: [{ model: "claude-opus-4-8", tokens: emptyTokens(), tokenShare: 1, usd: 1.5 }],
            usd: 1.5,
            tokens: emptyTokens(),
            subagents: [],
          },
        ],
        excludedCount: 0,
      },
      extras: {
        details: [{ label: "builder — abc123", row: ["builder", "abc123", "full"], text: "plain receipt text, no markup" }],
      },
    });
    const sanitized = sanitizePrReceiptPayload(payload);
    expect(sanitized).toEqual(payload);
  });
});

describe("sanitized payload renders safely through renderPrBody", () => {
  it("drops a javascript: artifact link so no dangerous link reaches the comment", () => {
    const payload = basePayload({
      extras: { artifactLink: { fileName: "pr.html", url: "javascript:alert(1)" } },
    });
    const rendered = renderPrBody(payload.bodyInput, sanitizePrReceiptPayload(payload).extras);
    expect(rendered).not.toMatch(/\]\(\s*javascript:/i);
    expect(rendered).not.toContain("full receipt:");
  });

  it("keeps a safe https artifact link in the rendered comment", () => {
    const url = "https://anandgupta42.github.io/receipts/view.html?x=1";
    const payload = basePayload({ extras: { artifactLink: { fileName: "pr.html", url } } });
    const rendered = renderPrBody(payload.bodyInput, sanitizePrReceiptPayload(payload).extras);
    expect(rendered).toContain("full receipt:");
    expect(rendered).toContain(url);
  });

  it("defangs a reference-style link definition in a live-markdown field", () => {
    const payload = basePayload({
      extras: { details: [{ label: "see [here][x]\n[x]: javascript:alert(1)", row: [], text: "t" }] },
    });
    const sanitized = sanitizePrReceiptPayload(payload);
    // brackets escaped → neither the [here][x] use nor the [x]: definition can form a link
    expect(sanitized.extras.details![0].label).not.toMatch(/\[x\]:/);
    expect(sanitized.extras.details![0].label).toContain("\\[");
  });
});

describe("SPEC-0066 sanitizer — link-target + autolink hardening (Codex)", () => {
  it("drops an artifactLink whose url tries to break out of the link target", () => {
    const payload = basePayload({
      extras: { artifactLink: { fileName: "p.html", url: "https://ok.example)![x](https://evil.example/pixel" } },
    });
    expect(sanitizePrReceiptPayload(payload).extras.artifactLink).toBeUndefined();
  });

  it("defangs a bare autolink URL in a live-markdown field", () => {
    const payload = basePayload({
      extras: { details: [{ label: "see https://evil.example now", row: [], text: "t" }] },
    });
    const label = sanitizePrReceiptPayload(payload).extras.details![0].label;
    // the raw https:// scheme is broken (zero-width space) → GitHub won't autolink it
    expect(label).not.toContain("https://");
    expect(label).toContain("evil.example");
  });

  it("leaves a bare URL literal inside fenced receipt text (inert there)", () => {
    const payload = basePayload({
      extras: { details: [{ label: "x", row: [], text: "ran https://example.com/api" }] },
    });
    expect(sanitizePrReceiptPayload(payload).extras.details![0].text).toBe("ran https://example.com/api");
  });
});

describe("SPEC-0066 sanitizer — email/mailto autolink defang (Codex)", () => {
  it("defangs bare email + mailto/xmpp autolinks in a live-markdown field", () => {
    const payload = basePayload({
      extras: { details: [{ label: "ping foo@evil.example or mailto:bar@evil.example or xmpp:baz@evil.example", row: [], text: "t" }] },
    });
    const label = sanitizePrReceiptPayload(payload).extras.details![0].label;
    expect(label).not.toContain("foo@evil.example");
    expect(label).not.toContain("mailto:bar");
    expect(label).not.toContain("xmpp:baz");
    expect(label).toContain("evil.example");
  });
});
