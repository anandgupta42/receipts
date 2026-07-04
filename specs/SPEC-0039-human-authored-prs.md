---
id: SPEC-0039
title: "Human-authored PRs — a declared receipt, not a permanent nag"
status: draft
milestone: M4
depends: [SPEC-0019, SPEC-0023]
---

# SPEC-0039 · human-authored PRs

Invariants: I2 (a human receipt shows NO dollars — a $0.00 claim is
unprovable and therefore banned), I3 (the declaration is labeled as a
declaration, never presented as detection), I6 (no human-vs-agent framing,
comparison, or judgment anywhere — the ledger records, it does not editorialize).

## Purpose

Maintainer ask (2026-07-04): handle the PR made by a human, not an agent.
Today that PR is a hole in the ledger: `aireceipts pr --post` exits 1
(`NO_MATCH`, `src/pr/index.ts:66`), and the `pr-receipt-check` notice nags
on every push forever — "receipt missing" is indistinguishable from
"nothing to receipt." On a repo whose brand is a complete ledger, the
distinction IS the feature: a human-authored PR should be able to say so,
once, honestly, and be done. The honesty bound is sharp and drives the
whole design: the tool can prove "no matching agent transcripts on this
machine" — it can NEVER prove "no AI was involved" (browser ChatGPT,
another machine, a deleted transcript, another checkout). So the artifact
is a **declaration**, made by the author, refused when local transcripts
contradict it, and worded to claim exactly two things and nothing more:
(1) the author declares it, (2) no matching local transcripts were found.
A clean machine can always declare falsely — the wording bound, not the
refusal gate, is what keeps the tool honest about that.

**Kill criterion:** (a) one concrete occurrence of a declared-human PR
on this repo where a later `pr --post` from the same machine finds
attributable sessions for pre-declaration commits (the refusal gate
failed at its one job) → the flag retires to a docs-only convention;
(b) wording misreads get exactly one Design-level copy iteration
(maintainer judgment on a real thread) before any structural change.

## Requirements

- **R1 — The declaration flag, with teeth.** `aireceipts pr --post
  --human` posts the human-authored receipt variant — but FIRST runs the
  normal session discovery, and **refuses** (exit 1, named reason) when
  any attributable session matches the branch: no declaration while the
  tool holds matching local transcripts (matching, not "proof" — the
  matcher includes cwd/time helper heuristics and says so in the refusal
  text). `--human` without `--post` renders locally, same refusal. `--human`
  with `--session` is a contradiction — registered in `src/cli/options.ts`
  (unknown flags currently fall through to positionals, so registration is
  part of this spec) and rejected in `runPr` exactly like the
  `--artifact requires --post` guard (`src/pr/index.ts:219`), tested
  through real CLI dispatch.
- **R2 — The human receipt, deterministic and dollar-free.** A compact
  fence in the receipt idiom (same width, dashed frame, wordmark):
  declared-by line (git `user.name`; `author unknown` when unset), the two-line declaration `author declaration: written by hand` /
  `no matching local agent transcripts found`, the PR number when posting (from the same `resolvePr` the upsert uses)
  or the branch name in local dry-run (no `gh` on that path), and the
  branch commit count — nothing else. Rendering is a pure function of
  injected inputs ({author, prOrBranch, commitCount}) — the determinism
  harness pins env only (`scripts/determinism-check.mjs:52`), so the
  golden is built from pinned fixture inputs, never live git config. NO totals line, NO $0.00, NO token rows (I2:
  absence of evidence is not a zero). Byte-golden
  (`goldens/human-pr.txt`), deterministic under the frozen-env check.
  Posted body = `DOGFOOD_MARKER` + this fence (the same marker keeps
  upsert semantics — a later agent-built push replaces the human receipt
  the normal way).
- **R3 — The check learns the third verdict.** `hasReceiptComment`
  (boolean today, `scripts/check-pr-receipt.mjs:14`) is replaced by a
  string `receiptVerdict(json): "found" | "missing" | "human-declared"`;
  the CLI prints the verdict and the workflow maps each to its notice: marker present + the declaration line = the notice
  reads `PR declared human-authored — ledger complete` and, as always,
  never fails the build. The nag ends for declared PRs.
- **R4 — Docs for the two human audiences.** `docs/pr-receipts.md` gains
  a short "Hand-written PRs" section (the flag, the refusal rule, what
  the declaration does and does not claim); CONTRIBUTING's receipt line
  gains the one-clause alternative (`…or, if you wrote it by hand,
  `npx aireceipts pr --post --human``). External contributors with no
  aireceipts at all remain exactly as today: neutral notice, never
  blocked.

## Scenarios

- **Given** a hand-written PR and no matching transcripts, **when**
  `pr --post --human` runs, **then** the human fence posts and the check
  reports `human-declared` on the next push.
- **Given** `--human` on a branch where discovery finds an attributable
  session, **then** exit 1 with a reason naming the found session — the
  declaration is refused.
- **Given** a declared-human PR that later gets agent-built commits and a
  normal `pr --post`, **then** the upsert replaces the human fence with
  the agent receipt (marker identity), and the check returns `found`.
- **Given** the same transcript-free machine twice, **then** the human
  fence is byte-identical (git user.name pinned in the fixture).

## Non-goals

- **Detecting AI involvement** — impossible locally; the tool never
  claims it (the declaration wording is the whole contract).
- **$0.00 receipts** (I2 — absence of transcripts is not a cost of zero).
- **Mixed PRs** (human commits alongside agent sessions): the existing
  `≥` floor already states "at least this much" — a human-portion
  annotation is a future spec if dogfood demands it.
- **Contradiction policing** (cut per S2: the marker upsert makes
  coexistence require manual comment surgery; the thread's edit history
  is already the audit trail — I3 without new machinery).
- **Verifying the declarer's identity** — git `user.name` is stated
  as-is; PR authorship is visible on the PR itself.
- **Org policy enforcement** (requiring declarations) — the check stays
  notice-only by SPEC-0019 R5 design.

## Test matrix

| Case | Input | Expected |
|---|---|---|
| R1 refusal | `--human` with a matching session fixture | exit 1; reason names the session; nothing posted |
| R1 flag registration | real CLI dispatch `pr --human --session x` | rejected with named reason; `--help` lists `--human` |
| R1 happy path | `--human`, zero matches | exit 0; fence rendered/posted |
| R2 golden | pinned fixture inputs | byte-equal `goldens/human-pr.txt`; no `$`, no token rows |
| R2 dry-run | `--human` without `--post`, no gh available | renders with branch name, exit 0, zero gh calls |
| R2 unset author | fixture without user.name | `author unknown` rendered |
| R2 determinism | frozen env ×10 | byte-identical |
| R2 upsert | human fence then agent `pr --post` | one marker comment, agent receipt wins |
| R3 verdict | comment JSON with declaration line | `human-declared`; notice text; exit 0 |
| R3 regression | found/missing fixtures | verdicts unchanged; external contributor with no comment still `missing` + neutral notice |
| R3 workflow mapping | pr-receipt-check.yml | each verdict maps to its notice text |
| R4 docs | pr-receipts.md + CONTRIBUTING | flag + refusal rule + one-clause alternative present |

## Success criteria

- [ ] A test PR on this repo demonstrates the full loop: declaration
      posted, check returns `human-declared`, then a real `pr --post`
      upserts over it and the check returns `found`.
- [ ] Refusal demonstrated live in this worktree (which has real
      sessions) with the output pasted in the PR.
- [ ] `npx tsc --noEmit`, `npx eslint . --max-warnings 0`, `npx vitest run`,
      `node scripts/verify-goldens.mjs`,
      `node scripts/determinism-check.mjs --runs=10 -- node scripts/verify-goldens.mjs`,
      `node scripts/spec-lint.mjs`, `node scripts/hygiene.mjs` all pass
      unmasked (`echo $?`).

## Validation

**2026-07-04 · S1 (self):** the spec's center of gravity is the wording
bound (claim exactly what the tool knows); every requirement is a pure
function, a registered flag, or a string verdict — all byte-testable.

**2026-07-04 · S2 (Codex, read-only, full capture): REWORK → reworked.**
9 findings, all accepted:
1. HIGH — "prove"/"human-authored" overclaimed → two-line declaration
   wording claims exactly (author declaration + no local match); refusal
   text says "matching", not "proof".
2. HIGH — clean-machine abuse uncatchable → acknowledged structurally:
   the wording bound is the mitigation, stated in Purpose.
3. HIGH — dry-run has no PR number → branch name locally, resolvePr when
   posting; both specced and rowed.
4. HIGH — golden can't depend on live git config → pure renderer over
   injected inputs; `author unknown` fallback; fixture-pinned golden.
5. MEDIUM — parse-seam misnamed → options.ts registration + runPr guard,
   real-dispatch tested.
6. MEDIUM — boolean helper can't grow a third value → string
   `receiptVerdict` + workflow notice mapping.
7. MEDIUM — missing rows → help/registration, dry-run-no-gh, unset
   author, workflow mapping, external-contributor regression added.
8. LOW — unmeasurable kill/success criteria → one-occurrence trigger,
   one-iteration copy rule, reproducible test-PR loop.
9. CUT R4 (contradiction surfacing) — accepted; upsert already prevents
   coexistence short of manual comment surgery; moved to Non-goals.

**2026-07-04 · S3 (value gate):** the nag this kills is real and recurring
(every human push re-notices); the cheapest evidence is this repo's own
next hand-edited PR — the success criteria script it.

**2026-07-04 · S4 (lint):** `node scripts/spec-lint.mjs` → 32 spec(s) OK,
exit 0.

Status remains draft pending maintainer approval (button 1).
