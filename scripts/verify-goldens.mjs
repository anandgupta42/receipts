#!/usr/bin/env node
// Verifies every committed golden fixture under test/fixtures/**/*.golden still
// byte-matches the receipt the current build produces (I5, AGENTS.md).
//
// Stub: no goldens are committed yet (Tier 0 — harness only). Once M1 lands the
// receipt renderer and the first golden fixtures, replace the body below with:
//   1. glob test/fixtures/**/*.golden
//   2. for each, regenerate the receipt for its paired input transcript
//   3. byte-compare; any mismatch -> print a diff and process.exit(1)

console.log("verify-goldens: no goldens yet (Tier 0 harness) — nothing to check.");
process.exit(0);
