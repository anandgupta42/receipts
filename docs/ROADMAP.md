# Roadmap

Honest and short, on purpose: order and reasons, never dates. For what's
actually shipped in the current release, see the current-state inventory in
[AGENTS.md](https://github.com/anandgupta42/receipts/blob/main/AGENTS.md).

## Now

Cost-attribution confidence (SPEC-0044): the shipped slices — the
`ConfidenceEvent` contract, the no-silent-drop guarantee, the per-model cost
matrix, the cache-write caveat, and the subagent double-count fix — are
already in the current release. The spec itself stays open until its
`--self-check` kill-criterion and cost-model docs land.

## Next

- **Integration with coding agents.** The handoff and standing rules are
  built to be read by a machine, not just pasted by a human. Claude Code
  hooks ship today (`aireceipts install-hook`); the deeper direction is
  agent-native integrations that consume `--handoff --json` directly — a
  hook or harness that reads the packet and acts on it without a human
  pasting anything.
- **Broader adapter coverage.** More coding agents parsed to the same
  per-turn depth Claude Code, Codex, Gemini CLI, and opencode already get.
- **The opt-in cost-per-turn benchmark (SPEC-0015).** The client contract —
  payload build, the allowlisted schema, `--dry-run`, the `[y/N]` consent
  flow — is shipped; sends stay disabled until a separate server spec owns
  cohort definitions, abuse policy, and the explicit network exception that
  would allow one (I1/I4).

## Later

- **A hosted GitHub App stays parked, not planned** (SPEC-0052). An App
  can't generate a receipt — the transcripts it would need live on the
  developer's machine, not on GitHub — and none of its three recorded
  revisit triggers (an org rejecting the per-repo workflow as the
  enforcement mechanism, a committed hosted org-aggregation product, or
  fork-PR contributors measurably losing receipts) has fired. It reopens
  only if one does.

## Principles

Local-first: your transcripts and code never leave your machine. Deterministic:
the same transcript in always renders the same receipt out, byte for byte.
No fabricated dollars, ever — every price traces to a dated, cited source.
Facts, not rankings: a receipt reports what a session cost; it never grades
or ranks one model or agent against another.
