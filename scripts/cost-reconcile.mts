// SPEC-0028 R2 — per-adapter cost-reconciliation gate. Maintainer-run,
// local-only: each adapter's registered fidelity validator checks its own
// sessions (codex: summed turns must equal the rollout's cumulative
// envelope exactly; claude-code: usage-shape invariants). Adapters without
// a validator are listed `no validator registered` — a visible coverage
// gap, never an implied pass.
//
//   node scripts/cost-reconcile.mjs [--limit N]
//
// Exit codes: 0 = every validated session reconciled; 1 = drift found or
// usage error; 2 = evidence insufficient (zero loadable sessions).
import { adapterFor } from "../src/parse/registry.js";
import { listSessions, loadById } from "../src/parse/load.js";
import type { AgentSource, FidelityFinding, SessionSummary } from "../src/parse/types.js";

const DEFAULT_LIMIT = 40;

// Strict argv: an unknown flag must never silently widen or narrow the run.
{
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--limit") {
      i++;
      continue;
    }
    console.error(`unknown argument "${args[i]}" — usage: [--limit N]`);
    process.exit(1);
  }
}
const limitIdx = process.argv.indexOf("--limit");
let limit = DEFAULT_LIMIT;
if (limitIdx >= 0) {
  const raw = process.argv[limitIdx + 1];
  if (raw === undefined || !/^[1-9]\d*$/.test(raw)) {
    console.error(`--limit must be a positive integer, got "${raw ?? ""}"`);
    process.exit(1);
  }
  limit = Number.parseInt(raw, 10);
}

const sessions = await listSessions();
const newest = sessions
  .filter((s: SessionSummary) => s.startedAt !== undefined)
  .sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0) || a.filePath.localeCompare(b.filePath))
  .slice(0, limit);

const reconciled = new Map<AgentSource, number>();
const noValidator = new Map<AgentSource, number>();
const unloadable: string[] = [];
const drift: { path: string; findings: FidelityFinding[] }[] = [];
let checked = 0;

for (const summary of newest) {
  const adapter = adapterFor(summary.source);
  if (!adapter?.fidelity) {
    noValidator.set(summary.source, (noValidator.get(summary.source) ?? 0) + 1);
    continue;
  }
  const session = await loadById(summary.source, summary.filePath);
  if (!session) {
    unloadable.push(summary.filePath);
    continue;
  }
  checked++;
  const findings = adapter.fidelity.validate(session);
  if (findings.length > 0) {
    drift.push({ path: summary.filePath, findings });
  } else {
    reconciled.set(summary.source, (reconciled.get(summary.source) ?? 0) + 1);
  }
}

for (const path of unloadable) {
  console.error(`unloadable session (excluded from evidence): ${path}`);
}
for (const [source, n] of [...reconciled.entries()].sort()) {
  console.log(`${source}: ${n} session(s) reconciled`);
}
for (const [source, n] of [...noValidator.entries()].sort()) {
  console.log(`${source}: no validator registered (${n} session(s) not checked)`);
}

if (checked === 0 && drift.length === 0) {
  console.error("evidence insufficient: zero loadable sessions with a registered validator (SPEC-0028 R2).");
  process.exit(2);
}
if (drift.length > 0) {
  for (const d of drift) {
    for (const f of d.findings) {
      console.error(`DRIFT [${f.check}] ${d.path}: ${f.detail}`);
    }
  }
  console.error(`${drift.length} session(s) failed reconciliation — unexplained drift blocks priced rows (SPEC-0028 kill criterion a).`);
  process.exit(1);
}
console.log(`PASS: ${checked} validated session(s), 0 drift.`);
process.exit(0);
