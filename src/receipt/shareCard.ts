// SPEC-0077 R6/R7 — the shareable-card share step. After the card image is
// written, this runs one fully-local gesture: it copies the IMAGE onto the OS
// clipboard (best-effort, the only subprocess), then PRINTS the caption, the X
// and LinkedIn web-intent URLs (SPEC-0035 rules — first-party, no tracking), and
// the honest one-drag note. The guarantee is no browser launch, no network
// socket, no upload, no OAuth (I1/I4). The caption is a fixed template built from
// extracted numbers — no model call, no repo/branch/project/title (R7/R4).
import type { CardModel } from "./card.js";
import { CARD_THINKING_REPLY, cardHeadline } from "./card.js";
import { buildIntentTargets } from "../pr/share.js";
import { copyImageToClipboard, defaultClipboardRunner, type ClipboardRunner } from "./clipboard.js";

const DRAG_NOTE = "drag the image in — composers can't attach it for you";

/**
 * Total tool CALLS across the card's tool rows, excluding the `(thinking/reply)`
 * pseudo-row (not a tool). Uniform over both scopes: the session's own rows and
 * the PR aggregate both carry `callCount`.
 */
export function cardToolCount(model: CardModel): number {
  return model.toolRows.filter((r) => r.tool !== CARD_THINKING_REPLY).reduce((total, r) => total + r.callCount, 0);
}

/** Matches ASCII control characters (C0 range + DEL), which must never enter a printed/encoded caption line. */
const CONTROL_CHARS = /[\u0000-\u001f\u007f]+/g;

/**
 * Strip control characters and collapse whitespace from a transcript-derived
 * string before it enters a caption (R7 — tool/model/agent strings are untrusted;
 * a newline could inject an extra printed line, and the intent-URL builder then
 * percent-encodes the result).
 */
function sanitize(value: string): string {
  return value.replace(CONTROL_CHARS, " ").replace(/\s+/g, " ").trim();
}

function plural(n: number): string {
  return n === 1 ? "" : "s";
}

/** SPEC-0077 R7 — session caption: `$<total> · <agent> · <n> tools`. No repo/branch/project/title (R4). */
export function sessionCaption(model: CardModel, agentLabel: string): string {
  const tools = cardToolCount(model);
  return `${cardHeadline(model)} · ${sanitize(agentLabel)} · ${tools} tool${plural(tools)}`;
}

/**
 * SPEC-0077 R7 — PR caption core (no URL): `PR #<n> — $<total> across <n> sessions`.
 * With `link`, the ` · full receipt ↓` suffix is added here; the URL itself rides
 * the intent-URL `url` field and the printed caption (never the image, R4/R5).
 */
export function prCaptionCore(model: CardModel, hasLink: boolean): string {
  const n = model.sessionCount;
  const base = `${model.scopeLabel} — ${cardHeadline(model)} across ${n} session${plural(n)}`;
  return hasLink ? `${base} · full receipt ↓` : base;
}

export interface CardShareInput {
  model: CardModel;
  /** The path the card image was written to (for the clipboard copy + the unavailable note). */
  imagePath: string;
  /** `png` copies the raster to the clipboard; `svg` skips the image copy (vector — no raster payload). */
  format: "png" | "svg";
  /** Session scope only — the agent label for the caption (never a title). */
  agentLabel?: string;
  /** SPEC-0077 R5 — the full-receipt permalink for the caption (PR `--link`, already validated public + local). Omitted → linkless. */
  link?: string;
}

export interface CardShareDeps {
  out: (line: string) => void;
  platform: NodeJS.Platform;
  clipboard: ClipboardRunner;
}

export interface CardShareResult {
  clipboardImageCopied: boolean;
  linkIncluded: boolean;
}

export function defaultCardShareDeps(out: (line: string) => void): CardShareDeps {
  return { out, platform: process.platform, clipboard: defaultClipboardRunner };
}

/**
 * SPEC-0077 R6 — run the local share step for a written card. Returns the two
 * booleans the `card_generated` telemetry event needs (R8). Prints only; the
 * sole side effect beyond stdout is the best-effort local clipboard subprocess.
 */
export function runCardShare(input: CardShareInput, deps: CardShareDeps): CardShareResult {
  const hasLink = input.link !== undefined && input.link !== "";
  const core = input.model.scope === "pr" ? prCaptionCore(input.model, hasLink) : sessionCaption(input.model, input.agentLabel ?? "");
  const printedCaption = hasLink ? `${core} ${input.link}` : core;
  const intents = buildIntentTargets({ text: core, url: hasLink ? input.link : undefined });

  // (a) One clipboard payload: the IMAGE (PNG only; an SVG has no raster to copy).
  let clipboardImageCopied = false;
  if (input.format === "png") {
    clipboardImageCopied = copyImageToClipboard(input.imagePath, deps.platform, deps.clipboard);
  }
  if (clipboardImageCopied) {
    deps.out("✓ image copied to clipboard");
  } else if (input.format === "svg") {
    deps.out(`clipboard image copy is PNG-only; SVG saved to ${input.imagePath}`);
  } else {
    deps.out(`clipboard copy unavailable; image saved to ${input.imagePath}`);
  }

  // (b) The caption is PRINTED (never on the clipboard — one payload, the image).
  deps.out(`caption:  ${printedCaption}`);

  // (c) X + LinkedIn web-intent URLs (SPEC-0035 rules: first-party, no tracking).
  deps.out("share:");
  deps.out(`  X:        ${intents.x}`);
  deps.out(`  LinkedIn: ${intents.linkedin}`);

  // (d) The honest one-drag note — composers cannot attach the image for you.
  deps.out(`↳ ${DRAG_NOTE}`);

  return { clipboardImageCopied, linkIncluded: hasLink };
}
