# The harness — how this repo builds itself

aireceipts is designed, implemented, and maintained mostly by AI coding agents. That is
not a stunt; it is the constraint the whole repository is engineered around. This
document explains the machinery (the "harness"), how a change flows through it, and why
each piece exists. The maintainer's standing job is four buttons — everything else is
supposed to run under gates that don't trust anyone, human or model.

## Motivation

Agent-written code fails in patterned, well-documented ways, and every structure here
maps to one of those patterns:

| Failure pattern | Counter-structure |
|---|---|
| Agents over-build on vague asks ("over-eagerness") | Interview gate before any spec is drafted |
| Specs and code drift apart | Spec-under-git is the post-merge truth; `spec-lint` in CI |
| Plausible-but-wrong specs survive to implementation | S1–S4 validation, incl. an independent critic, **before** approval |
| Agents game test coverage (assertions weakened to pass) | Mutation testing on the money paths — coverage is advisory, mutation score gates |
| A model approves its own work (shared blind spots) | Generator ≠ critic, different model families, review recorded |
| Fabricated facts (prices, dollars, claims) | Hooks + CI reject uncited price data mechanically; invariant I2 bans fallback dollars |
| Output drift nobody notices | Golden receipts, byte-compared, re-run N× under a frozen environment |
| Bloated agent context degrades work | AGENTS.md hard-capped at 150 lines; reference, never duplicate |
| Docs rot behind the code | Docs ride in the feature PR; a two-lens docs panel blocks releases |

The through-line: **never rely on an agent remembering a rule when the rule can be a
gate.** Discipline that lives in prose gets skipped under pressure; discipline that
lives in an exit code doesn't.

## The pieces

**The constitution — `AGENTS.md`.** One file, ≤150 lines (CI-enforced), holding the
mission, the verification commands (identical to CI, so "passed locally" means "passes
CI"), the file-ownership map, and invariants **I1–I6** (deterministic & offline-complete;
never fabricate a dollar; every number traceable; diagnostics-only telemetry, disclosed
and escapable; byte-stable output; facts, never rankings). The invariants are restated in
every spec and skill — repetition is the point; it is what keeps dozens of independent
agent sessions from drifting.

**The spec system — `specs/`.** Every change starts as a spec: machine-readable
frontmatter (`status: draft|approved|building|shipped|rejected|superseded`), numbered
testable requirements, Given/When/Then scenarios, a test matrix (every requirement must
have rows — `scripts/spec-lint.mjs` fails the build otherwise), success criteria, and a
kill criterion. Rejected specs are kept as tombstones with their reasoning: the harness
treats a well-evidenced *no* as an artifact worth as much as a yes.

**Validation — S1–S4, before approval.** A draft cannot reach the maintainer without a
recorded validation: **S1** self-audit (is every promised line computable from local
data? no predictions, no judgment calls dressed as facts), **S2** an independent critic
in a different model family attacking measurability, feasibility against real code, and
scope, **S3** a value-gate dry run against the kill criterion, **S4** mechanical lint.
In this repo's first week the critic returned REWORK on 7 of 13 drafts — every one a
real catch (wrong quota semantics, an unpriceable adapter claim, a network call hiding
in an export spec). Approval means approving a spec that already survived attack.

**Skills — one per task type, maintainer-curated.** `.claude/skills/` holds the
operating procedures: `write-spec`, `validate-spec`, `build-spec`, `review-pr`,
`review-docs`, `release`, `fix-issue`, `ci-fix`, `improve`, plus the extension-surface
guides (`add-vendor-adapter`, `add-waste-check`, `update-prices`, `use-aireceipts`).
Agents cannot add or edit skills — curating this surface is one of the four buttons.

**Milestone builds — agent teams with directory ownership.** Large specs (M-files)
embed their own team plan: roles own *directories*, never features (no write
conflicts); work is sliced into dependency waves with one named critical path; shared
files have exactly one owner. Model assignment is part of the plan: the lead
(frontier-tier) authors all design/UX artifacts and makes judgment calls; critical-path
code runs on the strongest coding model; mechanical work may run lighter; deep review
runs in a different model family. Agents write files but never commit — the lead runs
the gate and commits at wave boundaries.

**Quality gates — layered, and hostile by design.** Typecheck → lint → tests → golden
receipts (byte-equal) → property tests → **mutation testing** on `src/pricing/**`
(fail-closed: pricing code without a mutation config fails CI) → determinism harness
(goldens re-run ×20 under frozen `NO_COLOR`/TZ/locale) → an eval corpus asserting
**precision 1.0** for the waste detectors (any false positive fails the build) →
independent PR review, recorded. Data has its own gates: every price row must carry a
cited source (a Claude Code hook blocks uncited writes at the tool level; a CI job is
the authoritative check — the hook is UX, the exit code is law).

**The docs loop.** Any user-visible change updates the docs in the same PR
(`build-spec` refuses "docs later"). Before a release, `review-docs` runs a two-lens
panel: a cold reader who has never seen the repo must succeed with the README alone
(simplicity), and a separate auditor executes every documented command and traces every
claim to code (correctness). Docs that overclaim are treated as bugs.

**Maintenance loops.** Scheduled work runs on cadences with hard ceilings: daily price
freshness (one cited PR per vendor), weekly dependency hygiene, label-triggered
issue→PR runs, and a capped self-improvement loop that must survive an external value
gate before anything lands. Telemetry's `parse_failure` event is the format-drift
sensor: when an agent vendor changes its transcript format in the wild, the maintenance
loop hears about it.

## How a feature flows

```
idea/issue
  → write-spec      (interview gate → draft, status: draft)
  → validate-spec   (S1 self-audit → S2 independent critic → S3 value gate → S4 lint;
                     record appended; REWORK loops back)
  → maintainer      (button 1: approve — or don't)
  → build-spec      (branch; design artifact from the lead if user-visible;
                     solo or team-waves; gates at every boundary; docs in the same PR)
  → review-pr       (independent deep review, different model family, recorded)
  → CI              (the full gate stack incl. mutation + cite-check + spec-lint)
  → maintainer      (merge)
  → release         (tag-matches-manifest guard → changelog → docs panel, blocking →
                     button 4: publish; only this step flips specs to `shipped`)
```

## The human surface

Four buttons, deliberately few: **(1)** approve or reject validated specs, **(2)**
one-click cited price-table PRs, **(3)** curate the skill surface, **(4)** cut releases.
Everything else — building, testing, reviewing, doc-keeping, dependency hygiene, price
freshness — is the harness's job. When the harness catches its own operator skipping a
step (it has), that is the system working.

## Lineage

The design distills two working ancestors — a spec-driven repo where agents shipped
~130 specs under similar invariants, and a milestone/agent-team build system — plus the
2025–26 evidence on spec-driven development, agent context budgets, mutation testing
versus coverage, and generator/critic separation. The shortest honest summary of all of
it: *make the harness, not the promises.*
