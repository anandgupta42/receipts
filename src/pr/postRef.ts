// SPEC-0066 R1/R3 — the CI RENDER path (no write token): fetch a branch's receipt ref
// from the PR head repo, validate + sanitize the untrusted payload, and render the comment
// body. The workflow runs this via `npx aireceipts-cli@latest pr-render-ref` WITHOUT
// GITHUB_TOKEN, then posts the sanitized body in a separate audited step — so a mutable
// npm package never holds the write token (Codex trust-boundary review). Generation stays
// local (I1/I4); this only re-renders what the producer already computed.
import { renderPrBody } from "./body.js";
import { deserializePrReceipt, preRenderedDollarViolation, sanitizePrReceiptPayload } from "./sanitize.js";
import { receiptRefSlug } from "./payloadTypes.js";
import { receiptRef } from "./store.js";

/** Validate + sanitize an untrusted ref payload JSON, then render the PR comment body. */
export function renderReceiptPayload(json: string): { ok: true; body: string } | { ok: false; reason: string } {
  const parsed = deserializePrReceipt(json);
  if (!parsed.ok) {
    return { ok: false, reason: parsed.reason };
  }
  const dollarViolation = preRenderedDollarViolation(parsed.payload);
  if (dollarViolation !== null) {
    return { ok: false, reason: dollarViolation };
  }
  const sanitized = sanitizePrReceiptPayload(parsed.payload);
  return { ok: true, body: renderPrBody(sanitized.bodyInput, sanitized.extras) };
}

export interface FetchRenderDeps {
  fetchRef: (slug: string, remoteUrl: string, cwd?: string) => boolean;
  readRef: (slug: string, cwd?: string) => string | null;
}

export interface FetchRenderArgs {
  branch: string;
  remoteUrl: string;
  cwd?: string;
}

/** `code`: 0 rendered (body set) · 2 no/unreadable ref · 3 invalid payload. Never posts. */
export interface FetchRenderOutcome {
  code: number;
  body?: string;
  message: string;
}

/**
 * Fetch the branch's receipt ref from `remoteUrl` (the PR head repo's clone URL) and render
 * it. `slug` is derived by the CLI's own `receiptRefSlug`, so it always matches what the
 * producer wrote (no shell-side drift). An unreadable/invalid ref renders nothing.
 */
export function fetchAndRenderReceipt(args: FetchRenderArgs, deps: FetchRenderDeps): FetchRenderOutcome {
  const slug = receiptRefSlug(args.branch);
  const ref = receiptRef(slug);
  if (!deps.fetchRef(slug, args.remoteUrl, args.cwd)) {
    return { code: 2, message: `no receipt ref ${ref} on the PR head repo` };
  }
  const json = deps.readRef(slug, args.cwd);
  if (json === null) {
    return { code: 2, message: `${ref} present but receipt.json is unreadable` };
  }
  const rendered = renderReceiptPayload(json);
  if (!rendered.ok) {
    return { code: 3, message: `invalid receipt payload — ${rendered.reason}` };
  }
  return { code: 0, body: rendered.body, message: `rendered receipt for ${ref}` };
}
