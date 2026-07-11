// SPEC-0077 R2 — build the PR-scope `CardModel` the shared `renderCardSvg`
// consumes. The session card projects one `ReceiptModel`; the PR card AGGREGATES
// the models the PR flow already builds: every top-level contributor plus its
// readable subagents (the `collectAtoms` universe, R2a-widened `SubagentRow`).
// Field derivation reuses the PR body's own `totalsFor`/`collectAtoms` for the
// headline + floor + cache, so the card and the comment count the same atoms.
//
// The cheaper-model line is OMITTED here (R2): an aggregate repricing lacks the
// per-atom price-row/vendor provenance to stay I2/I3-safe; it renders on the
// session card only. `scopeLabel` is the fixed `PR #<n>` — never repo, branch,
// owner, or a prompt-derived title (R4).
import type { TokenUsage } from "../parse/types.js";
import { addUsage, emptyUsage } from "../parse/util.js";
import type { CardModel, CardModelMixEntry, CardToolRow } from "../receipt/card.js";
import type { ModelMixEntry, ReceiptModel, ToolRow } from "../receipt/model.js";
import { isPartiallyPriced } from "../receipt/model.js";
import { cacheServedPct } from "../receipt/present.js";
import { collectAtoms, totalsFor, type ContributorView } from "./body.js";
import type { ConfidenceSummary } from "./confidence.js";
import { isFloored } from "./confidence.js";
import type { Role } from "./contributors.js";

/** One PR contributor as the card sees it: the view (usd/tokens/subagents/role) plus its own sliced `ReceiptModel` (the source of its tool rows). */
export interface PrCardEntry {
  view: ContributorView;
  model: ReceiptModel;
}

export interface PrCardMeta {
  /** In-repo candidates not credited (R1) — floors the headline (I2). */
  excludedCount: number;
  /** Folded confidence counts; any lower-bound event floors the headline. */
  confidence?: ConfidenceSummary;
}

/** The mix/tool breakdown of one readable atom (a contributor's own slice, or a readable subagent). Unreadable subagents contribute none (counted-only, I2/I3). */
interface CardAtom {
  modelMix: ModelMixEntry[];
  toolRows: ToolRow[];
}

/** Every readable atom's breakdown: each contributor's own model, then each of its readable subagents' retained detail (R2a). */
function readableAtoms(entries: readonly PrCardEntry[]): CardAtom[] {
  const atoms: CardAtom[] = [];
  for (const { view, model } of entries) {
    atoms.push({ modelMix: model.modelMix, toolRows: model.toolRows });
    for (const s of view.subagents) {
      if (!s.unreadable) {
        atoms.push({ modelMix: s.modelMix ?? [], toolRows: s.toolRows ?? [] });
      }
    }
  }
  return atoms;
}

/** Token-weighted PR model mix: sum each model's tokens across atoms, then share by the grand total. Ordered desc by share, then model name (as `ReceiptModel.modelMix` is). */
function aggregateModelMix(atoms: CardAtom[]): CardModelMixEntry[] {
  const byModel = new Map<string, number>();
  for (const atom of atoms) {
    for (const m of atom.modelMix) {
      byModel.set(m.model, (byModel.get(m.model) ?? 0) + m.tokens.total);
    }
  }
  const grandTotal = [...byModel.values()].reduce((sum, t) => sum + t, 0);
  if (grandTotal <= 0) {
    return [];
  }
  return [...byModel.entries()]
    .map(([model, tokens]) => ({ model, tokenShare: tokens / grandTotal }))
    .sort((a, b) => b.tokenShare - a.tokenShare || a.model.localeCompare(b.model));
}

/**
 * Sum usd/tokens/callCount by tool across atoms. A tool row shows a `$` ONLY
 * when EVERY contributing row priced; if any contributing row was unpriced
 * (`usd === null`) the aggregate `$` would be a silent lower bound, so the row
 * renders its tokens instead (I2 — never a bare exact `$` over mixed coverage).
 * Ordered like `ReceiptModel.toolRows`: priced desc by usd, then unpriced desc
 * by tokens, ties by name.
 */
function aggregateToolRows(atoms: CardAtom[]): CardToolRow[] {
  const byTool = new Map<string, { usd: number; tokens: TokenUsage; callCount: number; complete: boolean }>();
  for (const atom of atoms) {
    for (const r of atom.toolRows) {
      const acc = byTool.get(r.tool) ?? { usd: 0, tokens: emptyUsage(), callCount: 0, complete: true };
      acc.tokens = addUsage(acc.tokens, r.tokens);
      acc.callCount += r.callCount;
      if (r.usd !== null) {
        acc.usd += r.usd;
      } else {
        // An unpriced contribution makes the summed `$` a lower bound — mark the
        // row incomplete so it renders tokens, not a misleading exact dollar.
        acc.complete = false;
      }
      byTool.set(r.tool, acc);
    }
  }
  return [...byTool.entries()]
    .map(([tool, v]) => ({ tool, usd: v.complete ? v.usd : null, tokens: v.tokens.total, callCount: v.callCount }))
    .sort((a, b) => {
      if (a.usd !== null && b.usd !== null) {
        return b.usd - a.usd || a.tool.localeCompare(b.tool);
      }
      if (a.usd !== null) {
        return -1;
      }
      if (b.usd !== null) {
        return 1;
      }
      return b.tokens - a.tokens || a.tool.localeCompare(b.tool);
    });
}

/** `["1 orchestrator", "2 builders"]` — grouped role counts in a fixed order; the renderer joins them with ` + ` (matching the design's `1 orchestrator + 2 helpers` reading). */
function roleGroups(roles: Role[]): string[] {
  const order: Role[] = ["orchestrator", "builder", "codex"];
  const counts = new Map<Role, number>();
  for (const r of roles) {
    counts.set(r, (counts.get(r) ?? 0) + 1);
  }
  return order
    .filter((r) => (counts.get(r) ?? 0) > 0)
    .map((r) => {
      const n = counts.get(r) as number;
      return `${n} ${r}${n === 1 ? "" : "s"}`;
    });
}

/**
 * SPEC-0077 R2 — the PR-scope `CardModel`. `totalUsd`/`floored`/cache all reuse
 * the PR body's own aggregation (`totalsFor`/`collectAtoms`) over the same atom
 * universe the comment counts, so the two never disagree. Any readable-but-
 * unpriced atom, excluded candidate, or unreadable child forces the `≥` floor
 * (stricter than the comment's priced/unpriced split — the card shows one
 * headline). `cheaperModel` is intentionally absent (R2).
 */
export function buildPrCardModel(entries: readonly PrCardEntry[], prNumber: number, meta: PrCardMeta): CardModel {
  const contributors: ContributorView[] = entries.map((e) => e.view);
  const totals = totalsFor(contributors);
  const { atoms, childCount } = collectAtoms(contributors);
  const summed = atoms.reduce((acc, a) => addUsage(acc, a.tokens), emptyUsage());
  const breakdown = readableAtoms(entries);

  // SPEC-0077 R2 — a counted atom that priced but left some turns unpriced has a
  // `totalUsd` that is only a lower bound; the card shows ONE headline, so any
  // such contributor OR readable subagent floors it (`≥`) — stricter than the
  // comment's priced/unpriced split, and the same undercount the receipt caveat
  // discloses. Without this a partial atom renders an exact-looking `$`.
  const partialAtom =
    entries.some((e) => isPartiallyPriced(e.model)) ||
    entries.some((e) => e.view.subagents.some((s) => !s.unreadable && s.partialPriced === true));

  const floored =
    meta.excludedCount > 0 ||
    totals.unreadableCount > 0 ||
    totals.tokensOnlyCount > 0 ||
    partialAtom ||
    (meta.confidence !== undefined && isFloored(meta.confidence));

  const cache = cacheServedPct(summed);

  return {
    scope: "pr",
    scopeLabel: `PR #${prNumber}`,
    totalUsd: totals.pricedCount > 0 ? totals.pricedSubtotal : null,
    floored,
    tokens: summed.total,
    modelMix: aggregateModelMix(breakdown),
    toolRows: aggregateToolRows(breakdown),
    ...(cache !== undefined ? { cacheServedPct: cache } : {}),
    // cheaperModel omitted on the PR card (R2) — no per-atom price provenance.
    sessionCount: contributors.length,
    subagentCount: childCount,
    roles: roleGroups(contributors.map((c) => c.role)),
  };
}
