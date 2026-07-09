// SPEC-0066 R2/R3 — validate + sanitize the untrusted `PrReceiptPayload` read
// from `refs/aireceipts/<slug>` before it ever reaches `renderPrBody`. The ref is
// fork/branch-author-controlled input crossing a new trust boundary: CI parses
// it and posts the rendered result with a write token (`GITHUB_TOKEN`). Every
// string the payload carries is therefore untrusted and could carry a
// Markdown/HTML injection (`DetailReceipt.text` is pre-rendered Markdown;
// `label`, `row` cells, contributor model names, and waste-line strings are
// all attacker-influenceable).
//
// `deserializePrReceipt` never throws on hostile input — malformed JSON, an
// unknown `schemaVersion`, unknown fields at any level, non-finite numbers
// (reachable via a JSON literal like `1e400`, which parses to `Infinity`),
// and over-cap strings/arrays all fall through to `{ ok: false }`. CI treats
// that exactly like a missing receipt (R2) — it never posts an unvalidated
// payload.
//
// `sanitizePrReceiptPayload` then returns a deep copy with every
// attacker-influenceable string neutralized for safe embedding in a GitHub
// Markdown comment: a code-fence guard (an injected ``` must not break out of
// the receipt's own fence), raw-HTML neutralization (`<details>`, `<script>`,
// `<img onerror=...>` become inert text), Markdown-link defanging (`[text](url)`
// collapses to `text`, dropping the URL), and a length cap per field.
//
// Validation uses `zod` (already a dependency — see `src/telemetry/schemas.ts`
// / `src/receipt/exportSchema.ts` for the same `.strict()` pattern used here)
// rather than hand-rolled type guards: the payload's shape is deep (six levels
// of nesting through `ContributorView`/`ModelMixEntry`/`SubagentRow`/`WasteLine`),
// and `zod` gives unknown-key rejection (`.strict()`), non-finite rejection
// (`.finite()`), and length caps (`.max()`) at every level for free, instead of
// a few hundred lines of manual `typeof`/`Array.isArray` checks that would be
// far easier to under-cover.
import { z } from "zod";
import { PR_RECEIPT_SCHEMA_VERSION, type PrReceiptPayload } from "./payloadTypes.js";

/**
 * R2 — a sane upper bound on any single string in the untrusted payload;
 * anything longer is REJECTED outright (not sanitized) before any Markdown
 * rendering is attempted. Deliberately generous relative to the per-field
 * sanitize caps below — this is a "reject the absurd" ceiling, not the cap
 * that shapes the final comment.
 */
export const MAX_PAYLOAD_STRING_LENGTH = 200_000;

/**
 * R2 — a sane upper bound on any array in the payload. Guards against a
 * payload built to exhaust CI resources (e.g. a million-entry `contributors`
 * array) rather than to inject Markdown.
 */
export const MAX_PAYLOAD_ARRAY_LENGTH = 2_000;

/**
 * R3 — the sanitize-time truncation length for short, single-line display
 * fields (model names, labels, table cells, tool identifiers, artifact
 * fileName/url). Generous for legitimate content, small enough that a
 * hostile value can't dominate the rendered comment.
 */
export const SANITIZED_FIELD_CAP = 2_000;

/**
 * R3 — the sanitize-time truncation length for the largest free-text fields
 * (`DetailReceipt.text`/`subagents`, the pre-rendered per-session blocks).
 * Mirrors the value of `COMMENT_SIZE_CAP` in `body.ts` (module-private there,
 * so redefined here) — these are the fields whose size actually dominates a
 * rendered comment.
 */
export const SANITIZED_TEXT_CAP = 65_000;

const str = () => z.string().max(MAX_PAYLOAD_STRING_LENGTH);
const finiteNum = () => z.number().finite();
const boundedArray = <T extends z.ZodTypeAny>(schema: T) => z.array(schema).max(MAX_PAYLOAD_ARRAY_LENGTH);

const tokenUsageSchema = z
  .object({
    input: finiteNum(),
    output: finiteNum(),
    cacheRead: finiteNum(),
    cacheCreation: finiteNum(),
    cacheCreation5m: finiteNum().optional(),
    cacheCreation1h: finiteNum().optional(),
    total: finiteNum(),
  })
  .strict();

const modelMixEntrySchema = z
  .object({
    model: str(),
    tokens: tokenUsageSchema,
    tokenShare: finiteNum(),
    usd: finiteNum().nullable(),
  })
  .strict();

const sliceResultSchema = z
  .object({
    kind: z.enum(["slice", "full"]),
    startTurn: finiteNum(),
    endTurn: finiteNum(),
    turnCount: finiteNum(),
    label: str().optional(),
  })
  .strict();

const subagentRowSchema = z
  .object({
    name: str(),
    model: str().optional(),
    usd: finiteNum().nullable(),
    tokens: tokenUsageSchema,
    unreadable: z.boolean(),
    droppedRecords: finiteNum().optional(),
    filePath: str(),
  })
  .strict();

const confidenceSummarySchema = z
  .object({
    unattributableAnchorPool: finiteNum(),
    silencedGitWrite: finiteNum(),
    unreadableSubagent: finiteNum(),
    costLowerBoundCacheTier: finiteNum(),
    unreadableSession: finiteNum(),
    droppedTranscriptRecords: finiteNum(),
  })
  .strict();

const contributorViewSchema = z
  .object({
    role: z.enum(["orchestrator", "builder", "codex"]),
    sessionId: str(),
    slice: sliceResultSchema,
    modelMix: boundedArray(modelMixEntrySchema),
    usd: finiteNum().nullable(),
    tokens: tokenUsageSchema,
    subagents: boundedArray(subagentRowSchema),
    basis: z.enum(["anchor", "helper", "message"]).optional(),
    durationMs: finiteNum().optional(),
  })
  .strict();

const prBodyInputSchema = z
  .object({
    contributors: boundedArray(contributorViewSchema),
    excludedCount: finiteNum(),
    detailsBelow: z.boolean().optional(),
    confidence: confidenceSummarySchema.optional(),
  })
  .strict();

const detailReceiptSchema = z
  .object({
    label: str(),
    row: boundedArray(str()),
    text: str(),
    subagents: str().optional(),
  })
  .strict();

const stuckLoopWasteLineSchema = z
  .object({
    kind: z.literal("stuck-loop"),
    tool: str(),
    runLength: finiteNum(),
    usd: finiteNum().nullable(),
    tokens: tokenUsageSchema,
    wallClockMs: finiteNum().nullable(),
    turnIndices: boundedArray(finiteNum()),
  })
  .strict();

const trivialSpansWasteLineSchema = z
  .object({
    kind: z.literal("trivial-spans"),
    eligibleTurnCount: finiteNum(),
    usd: finiteNum(),
    tokens: tokenUsageSchema,
    cheaperModel: str(),
  })
  .strict();

const contextThrashWasteLineSchema = z
  .object({
    kind: z.literal("context-thrash"),
    compactionCount: finiteNum(),
    turnSpan: finiteNum(),
    turnIndices: boundedArray(finiteNum()),
    usd: finiteNum().nullable(),
    tokens: tokenUsageSchema,
  })
  .strict();

const wasteLineSchema = z.discriminatedUnion("kind", [
  stuckLoopWasteLineSchema,
  trivialSpansWasteLineSchema,
  contextThrashWasteLineSchema,
]);

const handoffSectionDataSchema = z
  .object({
    wasteLines: boundedArray(wasteLineSchema),
    sessionCount: finiteNum(),
    turnCount: finiteNum(),
  })
  .strict();

const artifactLinkSchema = z
  .object({
    fileName: str(),
    url: str(),
  })
  .strict();

const prBodyExtrasSchema = z
  .object({
    artifactLink: artifactLinkSchema.optional(),
    details: boundedArray(detailReceiptSchema).optional(),
    handoff: handoffSectionDataSchema.optional(),
    // SPEC-0070 R4 — the opt-in tip-link flag round-trips through the ref payload;
    // omitted on older refs → deserializes as off (the new default).
    samosa: z.boolean().optional(),
  })
  .strict();

const prReceiptPayloadSchema = z
  .object({
    schemaVersion: z.literal(PR_RECEIPT_SCHEMA_VERSION),
    bodyInput: prBodyInputSchema,
    extras: prBodyExtrasSchema,
  })
  .strict();

export type DeserializeResult = { ok: true; payload: PrReceiptPayload } | { ok: false; reason: string };

/**
 * R2 — parse + structurally validate the untrusted ref blob. Never throws:
 * a `JSON.parse` failure, a wrong/missing `schemaVersion`, an unknown field
 * at any level (`.strict()` on every object schema), a non-finite number
 * (`.finite()` on every number field — reachable from valid JSON via an
 * extreme literal like `1e400`), or an over-cap string/array all resolve to
 * `{ ok: false }` rather than an exception.
 */
export function deserializePrReceipt(json: string): DeserializeResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return { ok: false, reason: "invalid JSON" };
  }

  const result = prReceiptPayloadSchema.safeParse(parsed);
  if (!result.success) {
    const first = result.error.issues[0];
    const path = first && first.path.length > 0 ? first.path.join(".") : "(root)";
    return { ok: false, reason: `${path}: ${first?.message ?? "schema validation failed"}` };
  }
  return { ok: true, payload: result.data as PrReceiptPayload };
}

/** Zero-width space (U+200B) — invisible to a reader, but splits a run of fence characters so it can never match a fence-opening/closing line. Written as an escape (not a literal character) so it stays unambiguous in diffs/review. */
const ZERO_WIDTH_SPACE = "\u200B";

/** Breaks up any run of 3+ backtick or tilde characters (GFM's two fence delimiters) with a zero-width space between every character, so an injected fence run can never be parsed as a fence-opening/closing line — while remaining visually identical to a reader. */
function guardCodeFences(value: string): string {
  return value.replace(/[`~]{3,}/g, (run) => run.split("").join(ZERO_WIDTH_SPACE));
}

/** HTML-entity-encodes `<`/`>` so any raw tag (`<details>`, `<script>`, `<img onerror=...>`, HTML comments) becomes inert text instead of a parsed element. */
function neutralizeHtml(value: string): string {
  return value.replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Collapses a Markdown link `[text](url)` to just `text`, dropping the URL entirely (a `javascript:`/`data:` URI or a phishing link never survives). */
function defangMarkdownLinks(value: string): string {
  // Allow one level of nested parens in the URL so `[t](javascript:alert(1))` fully
  // collapses to `t` instead of leaving a stray `)`. The alternation branches are
  // disjoint on the first char (non-paren vs `(`), so this can't backtrack (no ReDoS).
  return value.replace(/\[([^\]]*)\]\((?:[^()]|\([^()]*\))*\)/g, "$1");
}

/** Truncates to `maxLength` code points (not UTF-16 code units, so multi-byte characters aren't split), appending an ellipsis when truncated. */
function capString(value: string, maxLength: number): string {
  const chars = [...value];
  if (chars.length <= maxLength) {
    return value;
  }
  if (maxLength <= 0) {
    return "";
  }
  return chars.slice(0, maxLength - 1).join("") + "…";
}

/** Escapes Markdown link brackets so no link — inline `[t](u)`, reference `[t][r]`, or a `[r]: url` definition — can form from untrusted text. Runs AFTER inline-link defanging (which cleans the common `[t](u)` case), catching reference-style links and residual brackets that defanging leaves behind. */
function escapeMarkdownBrackets(value: string): string {
  return value.replace(/[[\]]/g, (bracket) => `\\${bracket}`);
}

/** Breaks GitHub's BARE autolinker (GFM turns a raw `https://…`, `http://…`, `ftp://…`, `www.…`, a bare email `a@b.tld`, or a `mailto:`/`xmpp:` form into a live link with no `[]()` syntax) by splicing a zero-width space into each trigger, so an attacker string in a live-markdown field can't become a clickable link. */
function defangAutolinks(value: string): string {
  return value
    // protocol schemes (http/https/ftp autolinked; mailto/xmpp become mail links)
    .replace(/(https?|ftp|mailto|xmpp):/gi, `$1:${ZERO_WIDTH_SPACE}`)
    // bare `www.` autolink
    .replace(/(www)\./gi, `$1${ZERO_WIDTH_SPACE}.`)
    // bare email autolink (`local@domain.tld`) — split the `@`
    .replace(/([\w.+-]+)@([\w-]+\.[\w.-]+)/g, `$1@${ZERO_WIDTH_SPACE}$2`);
}

/** A field rendered as LIVE Markdown (headings, table cells, the artifact link text): guard fences, neutralize raw HTML, defang inline + bare-autolink links, escape residual link brackets, then cap. */
function sanitizeMarkdown(value: string, maxLength: number): string {
  const guarded = guardCodeFences(value);
  const htmlSafe = neutralizeHtml(guarded);
  const linkless = escapeMarkdownBrackets(defangAutolinks(defangMarkdownLinks(htmlSafe)));
  return capString(linkless, maxLength);
}

/** A field rendered INSIDE a code fence (the pre-rendered per-session receipt `text`): Markdown is inert there, so only a fence breakout matters — guard fences and cap, and deliberately DON'T HTML-encode or escape brackets, which would corrupt the literal receipt bytes. */
function sanitizeFenced(value: string, maxLength: number): string {
  return capString(guardCodeFences(value), maxLength);
}

/** An `artifactLink.url` is rendered raw into a Markdown link TARGET (`[text](url)`). Allow
 * only `https://…` with NO character that could close the target early or open a new element
 * — no whitespace, and no `( ) [ ] < > \`` (a url like `https://ok)![x](evil` would otherwise
 * break out and render a second live link). Anything else returns null and the link is dropped.
 * A legitimate artifact URL (a github.io viewer link with a percent-encoded `?src=`) has none
 * of these raw. */
function safeArtifactUrl(url: string): string | null {
  return /^https:\/\/[^\s()[\]<>`]+$/i.test(url) ? url : null;
}

/**
 * R3 — returns a deep copy of `payload` with every attacker-influenceable
 * string neutralized for the exact position it renders into. Live-Markdown
 * fields (`extras.details[].label/row[]/subagents`, contributor model names,
 * `extras.handoff.wasteLines[]`, `extras.artifactLink.fileName`) get the full
 * fence/HTML/link/bracket treatment; `extras.details[].text` renders inside a
 * code fence and gets fence-guard + cap only; `extras.artifactLink.url` is a
 * link target and is `https://`-allowlisted (the whole link is dropped if it
 * isn't safe). Never mutates the input.
 */
export function sanitizePrReceiptPayload(payload: PrReceiptPayload): PrReceiptPayload {
  const sanitized = JSON.parse(JSON.stringify(payload)) as PrReceiptPayload;

  for (const contributor of sanitized.bodyInput.contributors) {
    for (const entry of contributor.modelMix) {
      entry.model = sanitizeMarkdown(entry.model, SANITIZED_FIELD_CAP);
    }
  }

  if (sanitized.extras.details) {
    for (const detail of sanitized.extras.details) {
      detail.label = sanitizeMarkdown(detail.label, SANITIZED_FIELD_CAP);
      detail.row = detail.row.map((cell) => sanitizeMarkdown(cell, SANITIZED_FIELD_CAP));
      detail.text = sanitizeFenced(detail.text, SANITIZED_TEXT_CAP);
      if (detail.subagents !== undefined) {
        detail.subagents = sanitizeMarkdown(detail.subagents, SANITIZED_TEXT_CAP);
      }
    }
  }

  if (sanitized.extras.handoff) {
    for (const line of sanitized.extras.handoff.wasteLines) {
      if (line.kind === "stuck-loop") {
        line.tool = sanitizeMarkdown(line.tool, SANITIZED_FIELD_CAP);
      } else if (line.kind === "trivial-spans") {
        line.cheaperModel = sanitizeMarkdown(line.cheaperModel, SANITIZED_FIELD_CAP);
      }
    }
  }

  if (sanitized.extras.artifactLink) {
    const url = safeArtifactUrl(sanitized.extras.artifactLink.url);
    if (url === null) {
      // A non-https target can't be made safe in link-target position — drop the link.
      sanitized.extras.artifactLink = undefined;
    } else {
      sanitized.extras.artifactLink.fileName = sanitizeMarkdown(sanitized.extras.artifactLink.fileName, SANITIZED_FIELD_CAP);
      sanitized.extras.artifactLink.url = url;
    }
  }

  return sanitized;
}
