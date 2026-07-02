---
name: add-waste-check
description: "Add a new waste line (a detector for a specific waste pattern, e.g. a retry loop or a needless model upgrade) to the aireceipts receipt. Use when the user asks to detect a new waste pattern, add a waste check, or flag a specific inefficiency."
trigger: /add-waste-check
---

# /add-waste-check — one waste pattern, one pure function

## 1. Spec first

`/write-spec` with a kill criterion: does this pattern actually occur in real
transcripts, at what frequency, and is it non-redundant with an existing waste check?
If you can't point to a real occurrence, don't build it yet.

## 2. Shape

A waste check is a **pure function** — `(session) => WasteLine[]` — deterministic, no
model calls, no network (I1). It lives in `src/pricing/waste/<name>.ts` and is added to
the waste-check registry (find the existing one; don't create a second).

Every emitted `WasteLine` must be traceable to specific tool calls in the transcript
(I3) — no aggregate "this session seemed wasteful" without pointing at the calls.

## 3. Near-zero false positives is the bar

This is a cost tool, not a judgement tool (I6) — one false "waste" flag erodes trust
fast. Ship with:
- **Positive fixtures:** real transcripts where the pattern occurs, named and committed.
- **Negative fixtures:** real transcripts that look similar but must NOT fire — these
  are the actual discipline; write more of these than positives.
- An **eval-corpus entry**: add the expected result to the eval corpus so CI fails if
  precision drops below the bar the spec sets.

## 4. Gate

Unmasked verification block, plus the FP battery (positives fire, negatives silent).
`src/pricing/**` changes must not regress the Stryker mutation score.

## 5. Land

`/build-spec` as usual. If in the `/improve` loop, the value gate (a corpus you didn't
author as fixtures) applies in addition to the FP battery above.
