// SPEC-0028 R2 — Claude Code fidelity validator: usage-shape invariants
// provable from the normalized Session. Duplicate raw-record detection is a
// named non-goal here (the normalized surface can't prove it) — it is handled
// upstream at parse time, where the adapter merges same-`message.id` records
// into one turn and keeps the maximum reported value of every billed usage
// component. The validator therefore expects already-merged, non-negative
// components and exact total arithmetic; it must never try to re-sum raw
// duplicate snapshots after normalization.
import type { AdapterFidelity, FidelityFinding, Session, TokenUsage } from "../types.js";

const COMPONENTS: readonly (keyof Pick<TokenUsage, "input" | "output" | "cacheRead" | "cacheCreation">)[] = [
  "input",
  "output",
  "cacheRead",
  "cacheCreation",
];

export const claudeCodeFidelity: AdapterFidelity = {
  validate(session: Session): FidelityFinding[] {
    const findings: FidelityFinding[] = [];
    let lastTs: number | undefined;
    for (const turn of session.turns) {
      if (turn.usage) {
        for (const c of COMPONENTS) {
          if (turn.usage[c] < 0) {
            findings.push({ check: "claude-negative-component", detail: `turn ${turn.index}: ${c} = ${turn.usage[c]}` });
          }
        }
        const sum = COMPONENTS.reduce((acc, c) => acc + turn.usage![c], 0);
        if (turn.usage.total !== sum) {
          findings.push({
            check: "claude-total-mismatch",
            detail: `turn ${turn.index}: total ${turn.usage.total} != component sum ${sum}`,
          });
        }
      }
      if (turn.timestamp !== undefined) {
        if (lastTs !== undefined && turn.timestamp < lastTs) {
          findings.push({
            check: "claude-time-regression",
            detail: `turn ${turn.index}: timestamp ${turn.timestamp} precedes prior turn's ${lastTs}`,
          });
        }
        lastTs = turn.timestamp;
      }
    }
    return findings;
  },
};
