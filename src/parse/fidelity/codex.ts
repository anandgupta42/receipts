// SPEC-0028 R2 — Codex fidelity validator: self-consistency between our
// derived per-turn usage and the rollout's own LOCAL cumulative envelope.
// For cumulative-envelope rollouts (Codex ≥0.137) the adapter removes the
// inherited baseline established by the first total/last pair from the final
// `total_token_usage`; the first local turn comes from `last_token_usage`, and
// every later turn comes from changed cumulative differences (never replayed-
// identical snapshots). Any dropped or duplicated delta therefore shows as
// drift. Tolerance is zero: same stream,
// exact equality is the contract. Legacy per-message rollouts sum to their own
// totals by construction, so the identity must hold there too.
import type { AdapterFidelity, FidelityFinding, Session, TokenUsage } from "../types.js";
import { addUsage, emptyUsage } from "../util.js";

const AXES: readonly (keyof Pick<TokenUsage, "input" | "output" | "cacheRead" | "cacheCreation" | "total">)[] = [
  "input",
  "output",
  "cacheRead",
  "cacheCreation",
  "total",
];

export const codexFidelity: AdapterFidelity = {
  validate(session: Session): FidelityFinding[] {
    let summed = emptyUsage();
    for (const turn of session.turns) {
      if (turn.usage) {
        summed = addUsage(summed, turn.usage);
      }
    }
    const reported = session.totals.tokens;
    const findings: FidelityFinding[] = [];
    for (const axis of AXES) {
      const ours = summed[axis];
      const theirs = reported[axis];
      if (ours !== theirs) {
        findings.push({
          check: "codex-envelope",
          detail: `${axis}: summed turns ${ours} != rollout cumulative ${theirs} (delta ${ours - theirs})`,
        });
      }
    }
    return findings;
  },
};
