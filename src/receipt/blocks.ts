// SPEC-0020: the receipt's layout-agnostic block AST. A `ReceiptView` is an
// ordered `Block[]`; both renderers (`render.ts`, `svg.ts`) are pure block
// interpreters (one terminal + one SVG layout per block kind, branching only on
// a block's own data — never on which template produced it). A template is a
// pure `buildReceiptView(model, template)` block-list builder (`present.ts`);
// adding one touches no renderer.
//
// Blocks are PLAIN SERIALIZABLE DATA — a JSON-safe discriminated union with no
// functions or closures. That is deliberate: it pins the contract for a future
// user-supplied template file (~/.aireceipts/templates/<name>.json) that
// `validateReceiptBlocks` can validate at load time, so the honesty invariants
// (I2/I3) are non-removable by construction rather than by renderer politeness.
import { combinedPricedUsd, type ReceiptModel } from "./model.js";
import { formatUsdFloor, formatUsdFloorLedger, usdFloorDecimals, type UsdFloorDecimals } from "./format.js";

export type TemplateName = "classic" | "grocery" | "datavis";

/** The maintainer-designed templates, in listing order (`classic` is the default). */
export const TEMPLATE_NAMES: readonly TemplateName[] = ["classic", "grocery", "datavis"];

export function isTemplateName(name: string): name is TemplateName {
  return (TEMPLATE_NAMES as readonly string[]).includes(name);
}

// --- Honesty constants (byte-equal battery targets, R3) ----------------------

/** SPEC-0001 R4(b): the trivial-spans waste label — must render with `≈`, never "a cheaper model would have handled this." */
export const TRIVIAL_SPANS_LABEL = "≈ re-priced short tool-free turns";

/** SPEC-0017 R7: the context-thrash methodology sub-line (I3 — discloses the refill estimate; ≤48 chars for the grocery grid). */
export const CONTEXT_THRASH_NOTE = "prompt load ≥80% of prior peak within 5 turns";

/** SPEC-0001: the price-delta honesty note — arithmetic, never a prediction. */
export const PRICE_DELTA_NOTE = "(arithmetic, not a prediction)";

/** Two grocery columns for one line: right-aligned quantity and amount. */
export interface GroceryCols {
  qty: string;
  amt: string;
}

/** Text alignment for a `note` block (default `left`). */
export type NoteAlign = "left" | "center";

/**
 * One receipt block. The 11 kinds are the template-file contract — do not add a
 * kind without a spec. Fields are the implementer's domain: they carry only the
 * display strings a renderer lays out, never pricing/attribution logic.
 */
export type Block =
  /** Centered bold wordmark (top of the card). */
  | { kind: "masthead"; text: string }
  /** Centered muted context lines (title, agent · start · duration, model mix, cache). */
  | { kind: "meta"; lines: string[] }
  /** Grocery's `ITEM / QTY / AMT` column header. */
  | { kind: "columnHeader"; item: string; qty: string; amt: string }
  /**
   * A tool/data row. `columns` (grocery) lays it out on the 50-char ITEM/QTY/AMT
   * grid; otherwise it is a `.`-leader `label ... value` line (`muted` dims it,
   * e.g. the price-delta row). `value` always carries the priced string so the
   * honesty scan sees one source of truth even in grocery mode.
   */
  | { kind: "row"; label: string; value: string; muted?: boolean; columns?: GroceryCols; spaceBefore?: boolean }
  /** A waste line: `badge` shows the ⚠/triangle marker (stuck-loop); `detail` is the trivial-spans sub-line. */
  | { kind: "wasteRow"; label: string; value: string; badge: boolean; detail?: string; spaceBefore?: boolean }
  /** The solid separator drawn above the total. */
  | { kind: "rule" }
  /** The bold total row (grocery `columns` right-aligns the amount). */
  | { kind: "total"; label: string; value: string; columns?: GroceryCols }
  /** A single annotation line (degraded-mode note, price-delta note, TXN#, CARDHOLDER, section/category labels). */
  | { kind: "note"; text: string; indent?: number; align?: NoteAlign; muted?: boolean; spaceBefore?: boolean }
  /** A wrapped, muted fine-print paragraph (no core template emits one since SPEC-0055 dropped the on-card methodology brief; the kind stays for renderer parity). */
  | { kind: "footnote"; text: string; spaceBefore?: boolean }
  /** Grocery's deterministic pipe-barcode. */
  | { kind: "barcode"; pattern: string }
  /** The closing line (SPEC-0055: plain text — the receipt card draws no samosa glyph or mark). The SVG stamp is emitted unless `stamp: false`; terminal rendering is unaffected. */
  | { kind: "footer"; text: string; stamp?: boolean };

/** The layout-agnostic receipt: an ordered block list every renderer interprets. */
export interface ReceiptView {
  template: TemplateName;
  blocks: Block[];
}

// --- Deterministic block-data helpers ----------------------------------------

/**
 * A stable, opaque 8-hex transaction token for the grocery TXN# and barcode.
 * The spec calls for a "sessionId-prefix-8", but a session's id in this codebase
 * is its transcript FILE PATH — a raw prefix would render a filesystem path
 * fragment (`TXN #/Users/a…`) that both looks broken and LEAKS the path on a
 * receipt built to be screenshotted and shared. Hashing (FNV-1a/32) keeps the
 * token deterministic and session-distinguishing while carrying no path bytes.
 */
export function sessionToken(sessionId: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < sessionId.length; i++) {
    hash ^= sessionId.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).toUpperCase().padStart(8, "0");
}

/** 8-group pipe-barcode from an 8-char token: each group is `(byte mod 4) + 1` pipes, groups space-joined. Deterministic — same token, same pattern. */
export function barcodePattern(token: string): string {
  const groups: string[] = [];
  for (let i = 0; i < 8; i++) {
    const width = ((token.charCodeAt(i) || 0) % 4) + 1;
    groups.push("|".repeat(width));
  }
  return groups.join(" ");
}

/** A normalized 10-cell bar `[####------]`: filled cells = round(value / max × 10), clamped. Empty bar when `max` is 0. */
export function normalizedBar(value: number, max: number): string {
  const filled = max > 0 ? Math.min(10, Math.max(0, Math.round((value / max) * 10))) : 0;
  return `[${"#".repeat(filled)}${"-".repeat(10 - filled)}]`;
}

/** Truncate `s` to `width` code points with a trailing `…` (keeps every grocery column inside its budget). */
function capField(s: string, width: number): string {
  const cp = [...s];
  return cp.length > width ? cp.slice(0, width - 1).join("") + "…" : s;
}

/**
 * Grocery column arithmetic (SPEC-0020 Design): the normal grid is ITEM 1–28,
 * QTY 30–37, AMT 39–50. When AMT is wider than 12 columns, it is never
 * truncated: ITEM shrinks first, then QTY. This keeps every realistic amount
 * complete (including its `≥`/`≈` qualifier) inside the 50-column receipt.
 */
export function groceryLine(item: string, qty: string, amt: string): string {
  if ([...amt].length <= 12) {
    return `${capField(item, 28).padEnd(28)} ${capField(qty, 8).padStart(8)} ${amt.padStart(12)}`;
  }

  const amountWidth = [...amt].length;
  const beforeAmount = 50 - amountWidth - 1;
  if (beforeAmount <= 0) {
    // Preserving the monetary claim is more important than clipping it. This
    // path needs an amount of at least 49 characters; ordinary and hostile
    // finite-token fixtures remain within the fixed grid.
    return amt;
  }
  const qtyWidth = Math.min(8, Math.max(0, beforeAmount - 2));
  if (qtyWidth === 0) {
    return `${capField(item, beforeAmount).padEnd(beforeAmount)} ${amt}`;
  }
  const itemWidth = beforeAmount - qtyWidth - 1;
  return `${capField(item, itemWidth).padEnd(itemWidth)} ${capField(qty, qtyWidth).padStart(qtyWidth)} ${amt}`;
}

// --- Honesty battery (R3): pure validator over the block list ----------------

/** One honesty-invariant breach found by {@link validateReceiptBlocks}. */
export interface BlockViolation {
  code: "dollar-in-unpriced" | "untraced-dollar" | "unqualified-dollar" | "missing-delta-note" | "waste-label-drift";
  detail: string;
}

const DOLLAR_AMOUNT_RE = /\$-?\d[\d,]*(?:\.\d+)?/g;

function dollarAmounts(s: string): string[] {
  return s.match(DOLLAR_AMOUNT_RE) ?? [];
}

function addDollar(out: Set<string>, usd: number | null | undefined, precision?: UsdFloorDecimals): void {
  if (usd !== null && usd !== undefined) {
    out.add(`$${formatUsdFloor(usd, precision)}`);
  }
}

function tracedDollarAmounts(model: ReceiptModel): Set<string> {
  const out = new Set<string>();
  const combined = combinedPricedUsd(model);
  const ledgerPrecision = usdFloorDecimals([
    ...model.toolRows.map((row) => row.usd),
    ...model.modelMix.map((entry) => entry.usd),
    model.subagents?.pricedUsd,
    combined,
  ]);
  const displayedLedger = formatUsdFloorLedger([
    ...model.toolRows.flatMap((row) => row.usd === null ? [] : [row.usd]),
    ...(model.subagents?.pricedUsd === null || model.subagents?.pricedUsd === undefined
      ? []
      : [model.subagents.pricedUsd]),
  ], ledgerPrecision, combined ?? undefined);
  for (const amount of displayedLedger.amounts) {
    out.add(`$${amount}`);
  }
  if (combined !== null) {
    out.add(`$${displayedLedger.total}`);
  }
  addDollar(out, model.totalUsd, ledgerPrecision);
  for (const row of model.toolRows) {
    addDollar(out, row.usd, ledgerPrecision);
  }
  for (const waste of model.wasteLines) {
    addDollar(out, waste.usd);
  }
  addDollar(out, model.priceDelta?.usd);
  // SPEC-0054 R4/R5 — DETAILS' cache counterfactual and BY MODEL splits.
  addDollar(out, model.cacheReadAtInputRateUsd);
  for (const entry of model.modelMix) {
    addDollar(out, entry.usd, ledgerPrecision);
  }
  addDollar(out, model.subagents?.pricedUsd, ledgerPrecision);
  addDollar(out, combined, ledgerPrecision);
  return out;
}

/** Every display string a block puts on the receipt — what the `$`-scan inspects. */
function blockStrings(b: Block): string[] {
  switch (b.kind) {
    case "masthead":
      return [b.text];
    case "meta":
      return b.lines;
    case "columnHeader":
      return [b.item, b.qty, b.amt];
    case "row":
      return b.columns ? [b.label, b.value, b.columns.qty, b.columns.amt] : [b.label, b.value];
    case "wasteRow":
      return b.detail !== undefined ? [b.label, b.value, b.detail] : [b.label, b.value];
    case "total":
      return b.columns ? [b.label, b.value, b.columns.qty, b.columns.amt] : [b.label, b.value];
    case "note":
      return [b.text];
    case "footnote":
      return [b.text];
    case "barcode":
      return [b.pattern];
    case "footer":
      return [b.text];
    case "rule":
      return [];
  }
}

/**
 * R3 honesty battery as a pure function over a block list — used by the tests
 * today and reusable unchanged as a load-time validator when user-supplied
 * templates arrive (a `--template-file` that fails validation refuses to
 * render). An empty result means the block list is honest. `model` supplies the
 * ground truth (did the session price? does it carry a price delta?) that the
 * blocks must not contradict.
 */
export function validateReceiptBlocks(blocks: Block[], model: ReceiptModel): BlockViolation[] {
  const violations: BlockViolation[] = [];
  const priced = combinedPricedUsd(model) !== null;

  if (priced) {
    const allowedDollars = tracedDollarAmounts(model);
    for (const b of blocks) {
      for (const s of blockStrings(b)) {
        for (const amount of dollarAmounts(s)) {
          const at = s.indexOf(amount);
          const prefix = at >= 2 ? s.slice(Math.max(0, at - 3), at) : s.slice(0, at);
          if (!/[≥≈]\s*$/u.test(prefix)) {
            violations.push({ code: "unqualified-dollar", detail: `priced receipt renders exact-looking ${amount} in ${b.kind}: ${s}` });
          }
          if (!allowedDollars.has(amount)) {
            violations.push({ code: "untraced-dollar", detail: `priced receipt renders untraced ${amount} in ${b.kind}: ${s}` });
          }
        }
      }
    }
    if (model.priceDelta) {
      const hasDeltaNote = blocks.some((b) => b.kind === "note" && b.text === PRICE_DELTA_NOTE);
      if (!hasDeltaNote) {
        violations.push({ code: "missing-delta-note", detail: "priced-delta receipt lacks the exact price-delta note" });
      }
    }
  } else {
    for (const b of blocks) {
      for (const s of blockStrings(b)) {
        if (s.includes("$")) {
          violations.push({ code: "dollar-in-unpriced", detail: `unpriced receipt renders a "$" in ${b.kind}: ${s}` });
        }
      }
    }
  }

  // A trivial-spans waste line must carry the exact `≈` label in every template.
  for (const w of model.wasteLines) {
    if (w.kind === "trivial-spans" && !blocks.some((b) => b.kind === "wasteRow" && b.label === TRIVIAL_SPANS_LABEL)) {
      violations.push({ code: "waste-label-drift", detail: "trivial-spans waste line missing the exact ≈ label" });
    }
  }

  return violations;
}
