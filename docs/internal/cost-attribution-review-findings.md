# Cost-attribution review findings (2026-07-05)

Four independent adversarial reviews of the merged SPEC-0044 foundation
(ConfidenceEvent contract + A1) plus the whole money path: Codex (non-Claude
model), a money-math re-derivation, an honesty forbidden-state red-team, and a
test-quality/mutation audit. Several findings were verified by hand by the lead.
The reviews found **real bugs the research, spec, and first build all missed** —
including a proven *visible* one.

Legend: forbidden state = a wrong/incomplete total shown with NO visible flag.

## Confirmed bugs, ranked

| id | finding | sources | evidence | effect |
|---|---|---|---|---|
| **B1** | Displayed rows ≠ displayed TOTAL. Rows are `formatUsd`'d individually; the total sums RAW usd (`body.ts:189`) then formats separately (`body.ts:222`) — no shared rounding basis. Same in single-session receipts (`present.ts` `rowAmount`/`totalParts`). | money-math (proven) + lead-verified | 3 rows @ $0.004 → rows show $0.00×3 (Σ $0.00) but TOTAL $0.01; 2 rows @ $0.006 → rows $0.01×2 (Σ $0.02) but TOTAL $0.01. | **Visible self-contradiction**, ±1¢, all templates, PR + session. No failure needed. Highest priority — a skeptic adds the column and it doesn't match. |
| **A3** | `cost-lower-bound-cache-tier` ConfidenceEvent is declared but **constructed nowhere** in `src/`. `resolve.ts cacheWriteCost` prices unsplit cache-write at the (cheaper) 5m/base rate — its own comment says it "may understate" — with no `≥`. | Codex + honesty + money-math | grep: event minted only in `confidence.ts`/tests, never a real site. | Under-reports TOTAL, no flag. Common (Codex/opencode/older Claude Code). Deferred → own build. |
| **B3** | Per-record parse-skip. `readJsonl` (`util.ts:128-130`) silently `continue`s on a malformed line; callers ignore `lineNo`/skip-count. opencode's per-row loop is identical. A crash-truncated line in a *credited* session drops that turn's cost with no event/floor/count. | honesty + lead-verified | `util.ts` "skip malformed line"; no caller tracks skips. | Silent under-count. Universal (all JSONL adapters + opencode rows). |
| **B4** | Whole-session load-failure silently skipped. `contributors.ts:163` drops an unloadable anchor-pool (or sibling-worktree repo-pool) candidate with no event; `promote.ts:35` drops any unloadable sidechain unconditionally. A1 only covers *loaded-but-full-fallback*, not *failed-to-load* — "couldn't read" ≠ "no anchor". | honesty + Codex | tests pin the silent behavior (`contributors.test.ts:197`, `promote.test.ts:83`). | Silent under-count, no flag. |
| **B5** | Grandchild double-count. If P→A→B and A independently commits (→ top-level contributor, excluded from P's rollup), B is not a contributor so not excluded; P's recursive `discoverChildFiles` finds B AND A's rollup finds B → B counted twice. | money-math | `children.ts:74-80` recursive discovery; `rollup.ts` excludes by exact file, not subtree. | Over-count. Narrow precondition (3-level nesting + middle commits). |
| **M1** | The hygiene "silent-drop ban" only regex-bans `excludedCount` mutation in 3 files — not bare `continue`/`return []`/helper files/pricing. The contract's own doc (`confidence.ts:9-14`) overstates its enforcement. | Codex + honesty | `hygiene.mjs:238` `checkNoSilentDrop`. | Why B1–B4 slipped through. Enforcement claim is aspirational. |
| **M2** | `unreadable-subagent` + `cost-lower-bound-cache-tier` are dead ConfidenceEvent variants (never emitted). `unreadable` is still flagged via a legacy path (`SubagentRow.unreadable` → `body.ts:219`), so visible; cache-tier has NO fallback. The "single typed enumeration" claim isn't literally true. | money-math + honesty | grep of `events.push`. | Contract/impl mismatch. |

## Verified NOT bugs (the reviews checked)

- A1 cannot double-count a session across `contributors.ts` and `promote.ts` —
  `index.ts:165` sorts each session into `candidates` XOR `sidechains`.
- `bodyInput.confidence` is always populated at the real CLI site (`index.ts:400`);
  the "confidence omitted → floor skipped" path is type-only, unreachable.
- `summarizeConfidence` exhaustiveness is real (a new variant fails the `never`
  assignment) — but it forces a *case*, not a *rendered* signal.

## Fix program (each red-then-green, Codex-reviewed, money paths Stryker-gated)

1. **B1** — the receipt must reconcile: displayed TOTAL == Σ(displayed rows).
   Fix the rounding basis + add an invariant test (matrix + ledger) that rows
   sum to total. *Priority — the visible one.*
2. **A3** — wire the `cost-lower-bound-cache-tier` emitter through the pricing
   path; render the lower-bound caveat. Stryker on the changed pricing files.
3. **B3 + B4** — parse-skip and load-failure emit ConfidenceEvents (a credited
   session that dropped records, or an unreadable candidate, is flagged).
4. **B5** — subtree-aware rollup dedup.
5. **M1 + M2** — broaden the hygiene check to real drop shapes; route the dead
   variants (or delete them + document the legacy path honestly).
