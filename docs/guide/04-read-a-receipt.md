# Read a receipt

Goal: produce and read the receipt for any one session — the newest, or a
specific one you pick.

## The default: your newest session

```sh
aireceipts
```

With no arguments, aireceipts computes the observable Standard-API floor for your
most recently ended session across every supported agent and prints its receipt:

```
- - - - - - - - - - - - - - - - - - - - - - - - -
                    AIRECEIPTS                    
 “Add email format validation to the signup for…” 
 Claude Code · Jun 18 2026 09:30:30 UTC · 10m 30s 
    claude-opus-4-8 87% · claude-sonnet-5 13%     
         cache served 85% of input tokens         

Bash..........................≥ $0.0517  (3 calls)
Edit..........................≥ $0.0455  (2 calls)
(thinking/reply)..............≥ $0.0310  (2 turns)
Write.........................≥ $0.0290  (2 calls)
Read...........................≥ $0.0192  (1 call)
--------------------------------------------------
TOTAL....................................≥ $0.1767
standard API-equivalent floor; not an invoice
same tokens on claude-haiku-4-5..........≥ $0.0392
  (78% lower observable floor)
  (arithmetic, not a prediction)
- - - - - - - - - - - - - - - - - - - - - - - - -
                npx aireceipts-cli                
         github.com/anandgupta42/receipts
- - - - - - - - - - - - - - - - - - - - - - - - -
```

Reading it top to bottom: the **title** is your opening prompt; the header line
gives the **agent, start time, and duration**; then the **model mix** (share of
tokens per model) and how much of the input was served from **cache**. The body
lists the **observable floor per tool**, highest first. `(thinking/reply)` is the model's own
output on turns that called no tool. The raw `TOTAL` is additive; `same tokens on …`
re-prices those exact tokens on a cheaper model as a reference point — the
percentage note compares the two observable floors, never predicts completion.

Each human `≥ $X` is independently rounded down: two decimal places for an
exact-cent value, four places when fractional cents remain. No cent is redistributed
between rows, so the displayed tool rows need not add exactly to the separately
floored `TOTAL`. Use `--json` or `--csv` for raw precision and explicit
lower-bound semantics.

A few lines appear only when they have something to say:

- a **pre-edit line** — `pre-edit: 11% of cost (1/10 turns)` — the share of
  the session's cost spent *before the first named edit-tool call*, and how
  many turns that covered. It's a shape fact, not a verdict: a hard bug can
  deserve a high share, and a routine edit usually doesn't — a share that
  surprises you is worth a look;
- a **stuck-loop waste line** names where to look — `at turns 1-5` — so you
  can jump straight to the loop in your own transcript;
- a **coverage caveat** — `caveat: 2 of 3 usage turns include unpriced tokens — TOTAL excludes
  those tokens` — whenever a session mixed a priced model with one that has no
  cited price row, so a partial TOTAL never poses as a complete one;
- an **unattributed-usage caveat** — Claude id-less response snapshots, Codex
  request streams that fail reconciliation, and componentwise-dominating
  opencode session aggregates can expose tokens without a trustworthy
  request/model join. They remain tokens-only instead of being assigned a fake
  dollar. A partial turn slice excludes session-level residuals; crossed
  opencode aggregate/itemized vectors keep the itemized total and report the
  positive conflict as excluded evidence;
- time-integrity caveats (inconsistent timestamps, skipped records) as before.

## The `--details` section

When the one question you have is *"what's inside that number?"*, ask for it:

```sh
aireceipts --details
```

```
DETAILS
tokens in / out..........................20k / 897
cache read / write.....................124k / 2.1k
turns / tool calls..........................10 / 8
peak turn.........................24k tok (turn 7)
same reads at uncached input rate..........≥ $0.51
  (arithmetic, not a prediction)
BY MODEL
claude-opus-4-8......................87% · ≥ $0.16
claude-sonnet-5......................13% · ≥ $0.01
```

The section slots between the price-delta line and the footer.
Line by line: **tokens in / out** is the raw prompt/completion split; **cache
read / write** shows whether caching is actually working (when the transcript
reports the cache-write TTL tiers, a `writes: 5m … · 1h …` sub-line appears —
absent data renders nothing, never a fabricated 0); **turns / tool calls** is
the session's shape; **peak turn** is the single most context-heavy request;
**same reads at uncached input rate** re-prices your cache-read tokens at the
plain input rate — a lower-bound counterfactual on the same cited price rows as
everything else; **BY MODEL** splits the observable floor per
model. Its raw values are additive, but its independently floored display rows
are not promised to sum visibly to `TOTAL`. Every line renders only when its data
exists in the transcript. `--details` composes with the default template only;
it also works with `--svg`.

## Pick a different session

First, list what's on disk — newest first:

```sh
aireceipts --list
```

```
1. [claude-code] Read config.yaml and check whether the port is set.  ·  Jun 25 2026 14:00:00 UTC  ·  2 tool calls
2. [claude-code] What HTTP status code should a successful DELETE return?  ·  Jun 24 2026 10:00:10 UTC  ·  0 tool calls
3. [codex] Run the flaky login test until it's green.  ·  Jun 23 2026 09:00:00 UTC  ·  3 tool calls
4. [codex] What does the --frozen-lockfile flag do in pnpm install?  ·  Jun 22 2026 16:00:06 UTC  ·  0 tool calls
5. [codex] The build fails because of a broken import in src/utils/formatDate.ts — can you fix it?  ·  Jun 20 2026 11:00:04 UTC  ·  3 tool calls
6. [claude-code] Add email format validation to the signup form and add a unit test for it. The signup form is in src/components/SignupF…  ·  Jun 18 2026 09:30:30 UTC  ·  8 tool calls
7. [claude-code] Can you fix the flaky login test in src/auth/login.test.ts? It's failing intermittently in CI.  ·  Jun 15 2026 14:00:25 UTC  ·  5 tool calls
```

Then select one three ways — a **1-based index** from the list, a **session id**,
or a **substring of the title**:

```sh
aireceipts 6                    # the sixth session listed
aireceipts "email format"       # matched by title substring
```

Both print the same receipt shown above. If a substring matches nothing, you get
`no session matched "…"` (see [Troubleshooting](12-troubleshooting.md)).

## The six-line version

For a glance instead of the full ledger:

```sh
aireceipts --mini "email format"
```

```
aireceipts · session receipt
Claude Code · claude-opus-4-8 · 10m 30s
total  ≥ $0.1767
top    Bash · ≥ $0.0517 (3 calls)
no flagged pattern detected
run  aireceipts  for the full receipt
```

This is exactly what the [SessionEnd hook](03-install-hook.md) prints.

## When there's no price

If a session ran on a model with no cited price row, the receipt shows **tokens,
never guessed dollars** — a deliberate honesty rule, not a failure. See
[How pricing is estimated](13-pricing.md) for why, and what it looks like.

## Next

- **[Compare two sessions](05-compare.md)** — put two receipts side by side.
- **[Aggregate the week](06-week.md)** — every session, totalled.
- **[Templates](10-templates.md)** — render the receipt in a different style.
