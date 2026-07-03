---
id: SPEC-0027
title: "Published receipt artifact — opt-in HTML page on a dedicated branch, linked from the comment"
status: draft
milestone: M4
depends: [SPEC-0023, SPEC-0026]
---

# SPEC-0027 · published receipt artifact (opt-in)

Invariants: I1 (artifact bytes deterministic — same session set, same file),
I2/I3 (the artifact renders the same curated models as the comment; no new
money semantics), I4 (local-first: publishing is an explicit per-invocation
user action over the user's own `gh`/git auth; no telemetry change, no
aireceipts server), I5 (the HTML exporter is a new output surface —
golden-gated like SVG).

## Purpose

Maintainer ask (PR #58 receipt review): *"add a link to a rendered html, that
we can store in a common branch to get access to it as a static artifact"* —
richer depth than a comment carries, one click away, hosted by nothing but
the repo itself. SPEC-0026's `<details>` section covers in-comment depth;
this spec covers the durable, linkable page. **Explicitly optional**: nothing
about `aireceipts pr` or `--post` changes unless `--artifact` is passed.

One hosting fact shapes the design: GitHub serves a branch-hosted HTML file
as **source** — it renders as a page only where the repo points Pages at the
artifact branch (classic branch-Pages; repos with workflow-based Pages, like
this one, cannot do both). The spec ships HTML anyway (it is the ask, and the
file is a durable artifact either way) but the comment link never promises
rendering the host won't deliver. *(A raster/vector image artifact was
considered and cut: the repo's PNG rasterizer explicitly disclaims byte
determinism — `src/receipt/png.ts:6` — and an image would need a new
PR-model SVG seam; see Validation, S2 findings 1/3/10.)*

**Kill criterion:** (a) any publish that writes outside the artifact branch
(working tree, index, current branch, any other ref) is a safety failure —
the feature ships disabled until fixed; (b) if in dogfood the maintainer
rejects the source-view landing experience (no Pages on this repo), the
artifact demotes to an entry in the SPEC-0026 details section and this
spec's branch machinery is tombstoned; (c) a link in a posted comment that
404s because its push never landed is an honesty bug — links may only render
after a confirmed push.

## Requirements

- **R1 — HTML artifact, deterministic, golden-gated.** For PR `<n>`,
  `aireceipts pr --post --artifact` produces `pr-<n>.html`: a self-contained
  page (inline CSS, zero external requests, no scripts, light/dark via
  `prefers-color-scheme`) rendering the concise multi-session rollup, each
  contributor's full per-tool receipt, waste lines, and the methodology
  text. Content parity is a hard bound: no string beyond what the terminal
  receipt surfaces already print (titles, tool names, counts, costs, labels)
  may appear. The exporter is a new module `src/pr/html.ts` consuming the
  per-contributor sliced `ReceiptModel`s that `runPr` already builds and
  currently discards after each view (`src/pr/index.ts:130-144` — retaining
  them alongside `ContributorView` is part of this change; the single-model
  `src/receipt/exporters.ts` seam is NOT reused, it types `ReceiptModel →
  string` for one session). Same session set → byte-identical file (I1),
  gated by goldens beside `goldens/svg/` (I5).
- **R2 — Branch write via plumbing, preserving siblings.** The file lands at
  the root of branch `aireceipts/artifacts` (created as an orphan with an
  empty root commit if missing), one commit per publish. The new tree is the
  current branch tip's tree with `pr-<n>.html` upserted — **every other PR's
  artifact is preserved** (an old comment's link must never die to a new
  publish). Implementation is git plumbing only (`hash-object` → `mktree` →
  `commit-tree` → `push <url> <sha>:refs/heads/aireceipts/artifacts`); the
  working tree, index, and current branch are never touched. On a
  non-fast-forward race: refetch the tip, rebuild the tree, retry once, then
  fail visibly.
- **R3 — One body, links only after a confirmed push (render-first
  preserved).** Order: build the artifact bytes → push the artifact branch →
  render the ONE final body — with the link line if and only if the push
  succeeded — print it to stdout, then upsert the comment once. The printed
  body and the posted body are identical (SPEC-0019 R3's spine, unchanged),
  and a link can never outrun its artifact (kill criterion c). The link is
  one markdown line under the SPEC-0026 details section:
  `full receipt: [pr-<n>.html](<base-repo-blob-url>)`. Push failed → body
  renders without the line, stderr names the failed push, exit 1 (the
  comment still posts — artifact failure is additive-only damage). The push
  URL and the blob URL derive from the same `gh pr view` resolution of the
  PR's **base repository** — one source of truth, so the branch pushed and
  the link shown cannot disagree; today's call requests `--json number` only
  (`src/pr/comment.ts:45`), widening it is in scope.
- **R4 — Opt-in, safe, inspectable.** `--artifact` is rejected without
  `--post` (the artifact exists to be linked). Before pushing, branch,
  remote URL, and file name are printed to stderr. Publishing rides the
  user's existing credentials; a contributor without push rights to the base
  repo gets the push error verbatim, never a crash, and the posted comment
  stays valid without the link. The flag is never implied by config,
  environment, or telemetry state (I4); CI never runs it (transcripts are
  local-only). New CLI flag → SPEC-0018 registry help text + e2e dispatch
  parse test.

## Scenarios

- **Given** `--post --artifact` on a three-session PR, **when** the publish
  succeeds, **then** `aireceipts/artifacts` gains/updates `pr-<n>.html` in
  one commit that preserves every other `pr-*.html`, and the stdout body ==
  posted body ends with the link line.
- **Given** the same command re-run after more commits, **then** the same
  path is overwritten and the comment still carries exactly one link line.
- **Given** a push rejection (no rights, or race lost twice), **then** the
  body renders and posts without the link, stderr names the failure, exit 1.
- **Given** `--artifact` without `--post`, **then** the command errors before
  rendering anything.
- **Given** the same session set twice, **then** the artifact bytes are
  identical (I1).

## Non-goals

- **Auto-publish / CI publish.** Transcripts never exist on runners (I4).
- **Configuring GitHub Pages.** Documented as an option for repos that want
  the HTML to render as a page; never automated.
- **An image artifact (PNG/SVG).** Cut per S2: PNG is not byte-deterministic
  by the repo's own contract and SVG needs a new PR-model seam; revisit only
  if the HTML artifact survives kill criterion (b) and demand appears.
- **Artifact history or GC.** One file per PR, overwritten in place.
- **External hosts, shorteners, or any non-GitHub storage.**
- **Embedding anything inline in the comment.** The maintainer chose
  concise; links only.

## Test matrix

| Case | Input | Expected |
|---|---|---|
| R1 golden | fixture PR model set | `pr-<n>.html` byte-equals its committed golden |
| R1 self-contained | rendered html | no `http(s)://` fetches, no `<script>`, no external fonts |
| R1 scheme | rendered html | one `prefers-color-scheme` media query; both palettes defined inline |
| R1 content parity | html vs terminal/details renders of same models | no string in html absent from those surfaces |
| R1 models retained | runPr with N contributors | N sliced `ReceiptModel`s reach the exporter (seam change) |
| R2 orphan create | no artifact branch | orphan root created; tree contains only `pr-<n>.html` |
| R2 preserve siblings | branch has `pr-58.html`; publish PR 59 | new tip tree contains both files |
| R2 overwrite | second publish, same PR | same path replaced; one new commit |
| R2 no-touch | publish with dirty working tree (mocked runner) | no working-tree/index/current-branch commands issued |
| R2 plumbing sequence | mocked runner | exact `hash-object → mktree → commit-tree → push` order, no porcelain writes |
| R2 race retry | first push non-fast-forward (mock) | refetch + one retry, then visible failure |
| R3 link after push | successful publish (mocked runners) | stdout body == posted body; exactly one link line |
| R3 no link on failure | failed push | body without link; posted; exit 1; stderr names push |
| R3 one resolution | mocked `gh pr view` | push URL and blob URL derive from the same base-repo answer |
| R4 flag guard | `--artifact` without `--post` | error before render |
| R4 preflight print | any publish | stderr lists branch, remote URL, file before push |
| R4 cli parse | `aireceipts pr --post --artifact` via real dispatch | flag accepted; help text lists it |
| determinism | same fixtures, repeated runs | identical artifact bytes and body (I1) |

## Success criteria

- [ ] This spec's own implementation PR publishes its receipt artifact to
      this repo's `aireceipts/artifacts` branch and its comment carries the
      working link; the source-view landing experience is recorded in the PR
      for the kill-criterion (b) judgment.
- [ ] `npx tsc --noEmit`, `npx eslint . --max-warnings 0`, `npx vitest run`,
      `node scripts/verify-goldens.mjs`, `node scripts/spec-lint.mjs` all pass
      unmasked (`echo $?`); new HTML goldens committed, existing goldens
      untouched.

## Validation

**2026-07-03 · S1 (self):** artifact content is bounded by content parity to
surfaces that already exist (no new disclosure); publishing is explicit,
credential-local, and additive-only (a failure can never damage the comment
or the checkout); determinism is golden-enforced. The one genuinely new risk
— writing refs in a user's repo — is fenced by plumbing-only R2 and kill
criterion (a).

**2026-07-03 · S2 (Codex, read-only): REWORK → draft reworked.** Findings and
disposition:
1. PNG byte-determinism claim contradicted `src/receipt/png.ts:6`'s own
   disclaimer — **accepted**; PNG artifact cut (with 3 and 10).
2. `exporters.ts` seam is single-`ReceiptModel`; `runPr` discards the
   per-contributor models the page needs — **accepted**; R1 now specifies a
   new `src/pr/html.ts` over retained models and names the discard point.
3. No PR-model SVG seam for the rasterizer — **accepted**; moot after 1.
4. `gh pr view` requests `--json number` only, so blob URLs weren't
   implementable as cited — **accepted**; R3 marks widening that call as
   in-scope.
5. Two-phase upsert broke SPEC-0019's render-first invariant (printed body ≠
   posted body) — **accepted**; R3 redesigned: push first, render once,
   stdout == posted, single upsert.
6. `mktree` could orphan prior PRs' artifacts → dead links in old comments —
   **accepted**; R2 now upserts into the existing tip tree; matrix row added.
7. Remote/owner ambiguity (forks, multiple remotes) — **accepted**; R3 pins
   push URL and blob URL to one `gh pr view` base-repo resolution.
8. Missing rows (scheme, privacy parity, flag parse, upsert-failure paths,
   plumbing sequence, sibling preservation) — **accepted**; rows added.
9. Subjective language ("richer insight", "renders everywhere") —
   **accepted**; Purpose restates the hosting facts plainly and kill
   criterion (b) is an explicit maintainer-judgment gate, which is how this
   repo's kill criteria fire.
10. Cut PNG as weakest — **accepted** (see 1); recorded in Non-goals with
    the revisit condition.

**2026-07-03 · S3 (value gate):** the ask is verbatim from the maintainer's
PR #58 review, with "we can make this optional" from the follow-up — the
opt-in shape is his. Kill-criterion (b)'s judgment evidence is built into the
success criteria: the spec's own PR must land the real link and record what
clicking it is actually like on a repo without branch-Pages.

**2026-07-03 · S4 (lint):** `node scripts/spec-lint.mjs` → 27 spec(s) OK,
exit 0.

Status remains draft pending maintainer approval (button 1).
