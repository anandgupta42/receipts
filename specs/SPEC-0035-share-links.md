---
id: SPEC-0035
title: "Shareable receipts — intent-only share, zero third parties, no leak"
status: building
milestone: M4
depends: [SPEC-0027]
---

# SPEC-0035 · shareable receipts

Invariants: I4 (local-first: no third-party script, SDK, pixel, or request
on any surface, ever), I1/I5 (the artifact and viewer stay byte-stable and
script-free where they already are), I3 (prefilled text discloses only what
the user already published).

## Purpose

Maintainer idea: *"providing a link to share the receipt over social media,
harden it a bit."* The shareable unit already exists — the viewer URL
(`SPEC-0027`, public repos only; private fetches 404 with an honest error).
The hardening is the whole design: share controls must add **no** third-party
resource and must live where clicks actually work. Two constraints from the
existing architecture force the shape: the artifact page is **script-free by
contract** and is rendered **inside a `sandbox=""` iframe** (`site/view.html`)
that blocks navigation — so share controls cannot be scripted there and any
`<a>` inside it is inert. Therefore the interactive share surface is the
**viewer chrome** (the `<header>`, outside the iframe, first-party, may use
JS), and the artifact page carries only inert plain-link fallbacks for the
direct-view case.

**Kill criterion:** any share mechanic that would require JavaScript on the
**artifact page**, a **third-party resource** anywhere (script/SDK/pixel/
font/iframe), or a **tracking parameter** (UTM et al.) is CUT, not
worked around. If link unfurls can't be made to leak nothing per-receipt
without per-receipt image generation (PNG determinism was cut in SPEC-0027),
unfurls fall back to a single static brand card — never a dynamic one.

## Requirements

- **R1 — Canonical URL from a capturing parser (the security core).** The
  existing `ARTIFACT_PATH` regex (`site/view.html:90`) proves shape but does
  not isolate `owner`/`repo`/`pr` as clean tokens — a crafted `?src=` can
  smuggle delimiters (`o&url=…`, `o%2Fr`, `%26`, `%3F`) into what would
  become a share target. This spec replaces it with a **capturing** parse:
  a raw `raw.githubusercontent.com` URL is split with `URL`/
  `URLSearchParams`, `owner` and `repo` must each match the GitHub slug set
  `^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,38})$`, the ref must equal
  `refs/heads/aireceipts/artifacts`, and the file must match `pr-\d+\.html`.
  Anything else → no render, no share. The shared URL is then **rebuilt**
  from those validated tokens via `new URL(...)` — never the raw `?src=`
  string, never `window.location`. `test/` proves the injection strings
  above all fail to produce a foreign share target.
- **R2 — Viewer chrome share controls (first-party, load-gated).**
  `site/view.html`'s header gains, only AFTER a successful load, an
  X/Twitter intent link, a LinkedIn share link, and a **Copy link** button
  (first-party JS, `navigator.clipboard`, no third-party origin). The error
  state (private repo, 404, parse failure) renders NO share affordance — an
  unresolved receipt is not shareable. The iframe stays exactly
  `sandbox=""` with no `allow-*`; the share row is chrome, never inside it.
- **R3 — Prefilled text: fixed template, URL as a separate parameter.**
  The X intent `text` is a FIXED string only — `An aireceipts cost receipt
  — what the AI agents actually cost.` — and the canonical URL is the
  separate `url` parameter (never concatenated into `text`, so no repo/PR
  bytes leak into the text field). LinkedIn's share-offsite takes the `url`
  parameter ONLY (no text field). Everything `URLSearchParams`-encoded; no
  `utm_*` or any added tracking key on any share URL. The only per-receipt
  datum shared is the canonical URL — the artifact the user already chose
  to publish.
- **R4 — Unfurl metadata: static, leak-free.** `site/view.html` gains
  Open Graph + Twitter Card meta: `og:title` "aireceipts — receipt viewer",
  a generic `og:description`, and `og:image` pointing at a **committed
  static brand card** (`site/og-card.png`, one file, no per-receipt data).
  Per-receipt unfurl images are a non-goal: they would need deterministic
  per-receipt PNGs, cut in SPEC-0027. `og:url` is omitted rather than wrong
  (view.html is one static file serving every receipt via `?src=`; a
  hardcoded `og:url` would misrepresent the specific link).
- **R5 — Optional terminal `--share` hint (after a confirmed comment).**
  `aireceipts pr --post --artifact --share` prints the ready-to-paste
  intent URLs to stderr **only after BOTH the artifact push AND the comment
  upsert succeed** (`src/pr/index.ts` — after `upsertPrComment` returns ok,
  not merely after the push), so the hint never advertises a receipt whose
  comment failed to post. Text only, no network. `--share` without
  `--artifact` errors like `--artifact` without `--post`. The flag never
  changes the posted comment body.

## Scenarios

- **Given** a receipt loads in the viewer, **then** the header shows X /
  LinkedIn / Copy-link controls whose target is the canonical viewer URL.
- **Given** a crafted `?src=` that passes the artifact-path regex but with
  odd casing/encoding, **then** the share URL is rebuilt from the parsed
  owner/repo/file, not echoed from the raw input.
- **Given** the viewer error state (private repo, 404), **then** no share
  control renders.
- **Given** the artifact page opened directly, **then** its footer share
  links work; **given** it inside the sandboxed viewer, **then** they are
  inert and labeled so.
- **Given** a link pasted into X/LinkedIn/Slack, **then** the unfurl shows
  the static brand card and generic title — no per-receipt data.
- **Given** `--share` without `--artifact`, **then** it errors.

## Non-goals

- **Any third-party share SDK, button widget, script, or pixel** — intent
  URLs and one first-party copy button only (kill criterion).
- **Per-receipt unfurl images** — static brand card only (SPEC-0027 PNG
  determinism cut).
- **Tracking/analytics/UTM on any share URL.**
- **Sharing private-repo receipts** — the viewer 404s them honestly; no
  share control appears on an unresolved receipt.
- **Scripting the artifact page** — it stays script-free; interactivity
  lives in the viewer chrome.
- **A Mastodon/Bluesky intent link** — no universal instance-agnostic
  intent URL exists; the Copy-link button covers every other network
  without a per-network dependency.

## Test matrix

| Case | Input | Expected |
|---|---|---|
| R1 controls present | successful viewer load (mocked fetch ok) | X/LinkedIn/Copy render; targets == canonical URL |
| R1 canonical not raw | `?src=` with unusual encoding passing the regex | share target rebuilt from parsed path, not raw echo |
| R1 no controls on error | mocked 404 | zero share affordances in DOM |
| R1 injection strings | `?src=` with `o&url=…`, `o%2Fr`, `%26`, `%3F` in owner/repo | all rejected; no share target built |
| R1 canonical rebuild | valid `?src=` | share URL built from parsed tokens via `new URL`, not raw echo |
| R2 posture | view.html | iframe stays `sandbox=""` no `allow-*`; share row is chrome; no third-party origin |
| R2 load-gated | mocked ok vs 404 | controls present on ok, absent on error |
| R3 text fixed | X intent `text` param | fixed template only; canonical URL only in `url` param |
| R3 linkedin url-only | LinkedIn share URL | `url` param only; no text field |
| R3 no utm | every share URL | no `utm_` / added tracking key |
| R4 og static | view.html head | og/twitter tags; og:image == committed static card; no og:url |
| R4 no third party | view.html | zero non-github/non-relative resource refs (distinguishing click destinations from loaded resources) |
| R5 timing | mocked push ok + upsert FAIL | no share hint printed |
| R5 flag hint | `--post --artifact --share` (mocked) | intent URLs on stderr; comment body unchanged |
| R5 flag guard | `--share` without `--artifact` | errors, exit 1 |
| S5 srcdoc CSP | mocked fetch returns `<img src="https://evil.example/pixel">` | frame CSP `<meta>` injected ahead of the hostile bytes; `default-src 'none'` |
| S5 literal shape | `?src=` with userinfo, `:444`, or a `%2e%2e` climb | rejected before fetch (URL normalization must be a no-op) |
| S5 PR match | artifact resolves PR 7, upsert resolves PR 8 (mocked flip) | share hint withheld; "share hint skipped" on stderr |

## Success criteria

- [x] The viewer share row works against a locally-served view.html with a
      mocked artifact (shown in the PR); a crafted injection `?src=`
      produces no foreign share target. (`test/site-share.test.ts` R1/R2 —
      accept + delimiter-smuggling/shorthand/host/filename/query-echo
      reject matrix, all via a `vm`-executed copy of the real inline
      script, not a reimplementation.)
- [x] Grep proves zero third-party **resources** (script/img/link/font/
      iframe src) across view.html + artifact + site — share-link `href`
      destinations are not resources and are the only external references.
      (`test/site-share.test.ts`'s kill-criterion `describe` block.)
- [x] `npx tsc --noEmit`, `npx eslint . --max-warnings 0`, `npx vitest run`,
      `node scripts/verify-goldens.mjs`,
      `node scripts/determinism-check.mjs --runs=10 -- node scripts/verify-goldens.mjs`,
      `node scripts/spec-lint.mjs`, `node scripts/hygiene.mjs` all pass
      unmasked (`echo $?`).

## Validation

**2026-07-03 · S1 (self):** the design is hardening-first: the only
interactive surface is first-party chrome the project fully controls; the
untrusted artifact and its sandbox are never touched; the sole per-receipt
datum shared is a URL the user already published. Every external string is
a click destination, never a loaded resource — I4 holds by construction.

**2026-07-03 · S2 (Codex, read-only, privacy-attack framing): REWORK →
reworked.** Findings:
1 (artifact `<a>` links not truly inert; cut R2) HIGH — **accepted**; the
artifact page is left untouched, its SPEC-0027 contract preserved; the old
inert-fallback requirement is deleted (the critic's recommended cut).
2 (ARTIFACT_PATH too loose for a share boundary — delimiter smuggling)
HIGH — **accepted**; R1 is now a capturing parser with GitHub slug
charsets and `new URL` rebuild, with injection strings as matrix rows.
3 (artifact links break the zero-http contract) MED — **resolved** by the
R2 cut. 4 (X vs LinkedIn param inconsistency leaking repo/PR into `text`)
MED — **accepted**; R3 fixes X `text` to the template only, URL as a
separate param, LinkedIn url-only. 5 (viewer posture not pinned) MED —
**accepted**; matrix row asserts `sandbox=""`/no `allow-*`/no third-party
origin. 6 (`--share` could outrun a failed comment upsert) MED —
**accepted**; R5 prints only after BOTH push and upsert succeed, with a
failure matrix row. 7 (flaky success criteria) LOW — **accepted**;
criteria rewritten to a local mocked check + a resource-vs-destination
grep. 8 (weakest = R2 artifact fallback) — **accepted** via the cut.

**2026-07-03 · S3 (value gate):** the kill criterion is enforceable at
review by grep (third-party resources) and by the injection-string tests
(forgery). No mechanic here needs artifact-page JS or a third party, so
nothing is at risk of the cut — the design was shaped to survive it.

**2026-07-03 · S4 (lint):** spec-lint OK.

**2026-07-03 · approved (button 1):** maintainer, in-session ("all specs
approved"). Design confirmations recorded on PR #77.

**2026-07-03 · S5 (Codex, read-only, build-diff review, share/injection/
forgery framing): 1 HIGH, 2 LOW — all accepted and fixed.** Findings:
1 (HIGH — `sandbox=""` blocks scripts but not passive loads: a hostile
"artifact" in any public repo with the right path could fire `<img src>`/
CSS `url()`/`<meta refresh>` requests and dress a forgery in this chrome)
— **accepted**; `confine()` now injects a frame CSP `<meta>`
(`default-src 'none'; style-src 'unsafe-inline'; base-uri 'none';
form-action 'none'`) ahead of every fetched document (after any doctype,
preserving standards mode) before it touches `srcdoc`; matrix row + tests
assert the CSP precedes hostile bytes and legit inline styles survive.
2 (LOW — validation ran after WHATWG URL normalization, so userinfo,
non-default ports, control characters, and `%2e%2e` dot-segment climbs
could *normalize into* an accepted shape) — **accepted**; `normalize()`
now rejects userinfo/ports outright and requires `u.href === input`
(normalization must be a no-op), with reject rows for each probe Codex
used. 3 (LOW — artifact publish and comment upsert each resolve the PR
independently; a mid-command `gh pr view` flip could share pr-N.html
against PR M) — **accepted** with the minimal in-scope guard: the hint
prints only when `link.fileName === artifactFileName(result.prNumber)`,
otherwise "share hint skipped" on stderr; mocked-flip matrix row added.
Codex confirmed as non-issues: delimiter smuggling into fetch/share
targets (canonical rebuild wins), fixed share text in both surfaces, and
no stdout/comment-body leak from the CLI hint.

**2026-07-03 · PR #77 comment (maintainer, folded in at build time per the
comment's own instruction):** "Maintainer confirmation (in-session,
2026-07-03): the prefilled share copy — 'An aireceipts cost receipt — what
the AI agents actually cost.' — is approved verbatim as the one string that
ships under the author's name." This exact string is what R3/`SHARE_TEXT`
ships; it is not edited anywhere in this build.
