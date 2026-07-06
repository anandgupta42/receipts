# Read a receipt

Goal: produce and read the receipt for any one session — the newest, or a
specific one you pick.

## The default: your newest session

```sh
aireceipts
```

With no arguments, aireceipts prices your most recently ended session across every
supported agent (Claude Code, Codex, Cursor, opencode) and prints its receipt:

```
- - - - - - - - - - - - - - - - - - - - - - - - -
                    AIRECEIPTS                    
 “Add email format validation to the signup for…” 
 Claude Code · Jun 18 2026 09:30:30 UTC · 10m 30s 
    claude-opus-4-8 87% · claude-sonnet-5 13%     
         cache served 85% of input tokens         

Bash..............................$0.05  (3 calls)
Edit..............................$0.05  (2 calls)
(thinking/reply)..................$0.03  (2 turns)
Write.............................$0.03  (2 calls)
Read...............................$0.02  (1 call)
--------------------------------------------------
TOTAL........................................$0.18
same tokens on claude-haiku-4-5...$0.04 (78% less)
  (arithmetic, not a prediction)

Per-turn cost split evenly across that turn's tool
calls; unpriced models show tokens only, never
guessed dollars. Full method: aireceipts
--methodology
- - - - - - - - - - - - - - - - - - - - - - - - -
       aireceipts · local · buy me a samosa       
- - - - - - - - - - - - - - - - - - - - - - - - -
```

Reading it top to bottom: the **title** is your opening prompt; the header line
gives the **agent, start time, and duration**; then the **model mix** (share of
tokens per model) and how much of the input was served from **cache**. The body
lists **cost per tool**, highest first. `(thinking/reply)` is the model's own
output on turns that called no tool. `TOTAL` is the sum; `same tokens on …`
re-prices those exact tokens on a cheaper model as a reference point — the
`(78% less)` is the same arithmetic as a percentage, never a prediction.

Three lines appear only when they have something to say:

- a **stuck-loop waste line** names where to look — `at turns 1-5` — so you
  can jump straight to the loop in your own transcript;
- a **coverage caveat** — `caveat: 2 of 3 tool rows unpriced — TOTAL excludes
  their tokens` — whenever a session mixed a priced model with one that has no
  cited price row, so a partial TOTAL never poses as a complete one;
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
same reads at uncached input rate............$0.52
  (arithmetic, not a prediction)
BY MODEL
claude-opus-4-8........................87% · $0.17
claude-sonnet-5........................13% · $0.01
```

The section slots between the price-delta line and the methodology footnote.
Line by line: **tokens in / out** is the raw prompt/completion split; **cache
read / write** shows whether caching is actually working (when the transcript
reports the cache-write TTL tiers, a `writes: 5m … · 1h …` sub-line appears —
absent data renders nothing, never a fabricated 0); **turns / tool calls** is
the session's shape; **peak turn** is the single most context-heavy request;
**same reads at uncached input rate** re-prices your cache-read tokens at the
plain input rate — the dollar figure caching saved you, arithmetic on the same
cited price rows as everything else; **BY MODEL** splits the priced total per
model (the rows always sum to `TOTAL`). Every line renders only when its data
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
total  $0.18
top    Bash · $0.05 (3 calls)
no waste detected
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
