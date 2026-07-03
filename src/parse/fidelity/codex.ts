// SPEC-0028 R2 — Codex fidelity validator: self-consistency between our
// derived per-turn usage and the rollout's own final cumulative envelope.
// For cumulative-envelope rollouts (Codex ≥0.137) the adapter sets
// `session.totals.tokens` to the agent's last `total_token_usage` snapshot
// while turn usage is derived from the `last_token_usage` deltas
// (src/parse/codex.ts:145-155) — so any dropped or double-counted event
// shows as drift between the two. Tolerance is zero: same stream, exact
// equality is the contract. Legacy per-message rollouts sum to their own
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
