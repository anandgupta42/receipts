# FAQ

Seeing an error or an odd receipt? That's
[troubleshooting](guide/12-troubleshooting.md) — symptom-first. This page is
question-first. (SPEC-0048.)

## How is this different from ccusage or my agent's built-in `/usage`?

Those are usage dashboards: [ccusage](https://github.com/ryoppippi/ccusage) and
your agent's built-ins aggregate what you spent over time — today, this week,
this billing window. aireceipts prints a receipt
for a **unit of work** — one session or one pull request — with cost attributed per
tool call, prices taken from cited and dated tables, and byte-deterministic output.
Use a dashboard to watch a trend; use a receipt to answer "what did *this* cost,
and can I check the number?" What a receipt can and can't prove:
[trust.md](trust.md).

## I'm on a flat-rate subscription — what do the dollar figures mean for me?

They are **API-equivalent arithmetic** on your real token counts — what the same
tokens would cost at the cited list prices — never a claim about your bill. On a
subscription, the receipt's plan-independent lines are the useful ones: per-tool
anatomy, cache economics, and waste lines. `aireceipts --quota` shows the official
rate-limit window state, which is the ceiling that actually constrains a
subscriber. How every dollar is computed: [pricing](guide/13-pricing.md).

## Does aireceipts send anything off my machine?

The product path is fully offline. The only network call is content-free telemetry
from a fixed nine-event catalog — never transcript content, prompts, file paths,
repo names, or dollar amounts. It is on by default; `aireceipts --telemetry-show`
prints exactly what the current run would send (and sends nothing), and
`AIRECEIPTS_TELEMETRY=off` or `DO_NOT_TRACK=1` means zero network calls. The
authoritative schema, field by field: [telemetry.md](telemetry.md).

## Can I trust the numbers? Could someone fake a receipt?

A receipt is the **author's disclosure** — verifiable in its arithmetic (anyone
with the transcript can re-render it and compare bytes), but not cryptographic
evidence: transcripts are plain files on the author's disk. Incompleteness is
labeled — totals floor with `≥` when a session couldn't be attributed — and
reconciliation checks plus time-integrity caveats make fabrication visible, not
impossible. The full statement of what a receipt proves, what it can't, and the
living list of ways the numbers can go wrong: [trust.md](trust.md).

## Why does my receipt show tokens but no dollars?

No cited, dated price row matched that session's model and date, and aireceipts
never guesses a dollar — that's an invariant, not a gap. The price tables live in
[`data/prices/`](https://github.com/anandgupta42/receipts/tree/main/data/prices),
one JSON per vendor, each row carrying the vendor page it was copied from and the
date it was observed. Add or update a row (with its citation) and the same
transcript re-prices. Method details: [pricing](guide/13-pricing.md).

## Why doesn't the receipt match my vendor's invoice?

The receipt is a **local estimate**: token counts from your transcript × cited
price tables, computed at render time. It is not a feed from your vendor's billing
system, and every fallback in the method is chosen to understate rather than
overstate. `aireceipts --methodology` prints the exact attribution rules the tool
applies. The full explanation of where estimate and invoice can diverge:
[pricing](guide/13-pricing.md).

## Why does my Cursor receipt show session totals only?

Cursor's local logs carry no per-turn usage, so splitting the total across tools
would be guesswork — and the receipt says "session totals only" instead of
guessing. That's the honest degraded mode: real numbers at the granularity the
transcript supports, nothing invented below it. How sessions are discovered and
attributed per agent: [session attribution](guide/14-session-attribution.md).

## Who builds this — is it really AI agents?

Largely, yes — under a spec-driven harness that doesn't trust them: mutation
testing on the money paths, byte-golden outputs re-run under a frozen environment,
cited-price checks in CI, and independent review before merge. Every pull request
in the repo carries the receipt of the agent sessions that built it. Human PRs are
welcome and run the same gates:
[CONTRIBUTING](https://github.com/anandgupta42/receipts/blob/main/CONTRIBUTING.md) ·
[how the harness works](https://github.com/anandgupta42/receipts/blob/main/docs/internal/harness.md).
