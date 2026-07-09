# Security policy

## Reporting a vulnerability

Report privately via [GitHub Security Advisories](https://github.com/anandgupta42/receipts/security/advisories/new)
for this repo — not a public issue, so nothing exploitable sits in the open
while it's unfixed. Include repro steps and, if relevant, the exact
`aireceipts --json` output (never a raw transcript — see below).

## What's in scope

The usual: remote code execution, arbitrary file read/write outside a
transcript directory, a supply-chain compromise in `scripts/` or the published
package, secret exfiltration.

Also **treated as security-grade here**, not just a bug:

- **A fabricated dollar amount** — a price rendered without a cited, dated row
  in `data/prices/**` backing it (invariant I2: never fabricate a dollar).
- **A telemetry event carrying transcript content, prompts, file paths, repo
  names, or dollar amounts** — the boundary in `docs/telemetry.md` is meant to
  be load-bearing, not aspirational.
- **A citation-check bypass** that lets an uncited price row merge.

## What's out of scope

Anything that requires the attacker to already control your local transcript
files or machine — aireceipts reads what's already on disk and doesn't create
a new trust boundary there. Reports with no working reproduction.

## What to expect

I read every report myself. Expect an acknowledgment within a few days, and a
fix (or a considered no, with reasoning) once I've reproduced it. Credit in the
release notes if you want it — say so in the report.
