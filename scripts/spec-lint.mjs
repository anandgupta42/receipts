#!/usr/bin/env node
// Mechanical spec lint (S4 of validate-spec). Checks structure only — the
// adversarial work is S1–S3. Exits 1 with itemized violations.
//
// Usage: node scripts/spec-lint.mjs specs/SPEC-0001-*.md  (or no args = all specs)

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const STATUS = new Set(["draft", "approved", "building", "shipped", "rejected", "superseded"]);
const REQUIRED_SECTIONS = ["## Purpose", "## Requirements", "## Non-goals", "## Test matrix", "## Success criteria"];

// SPEC-0000 is the product constitution (vision + invariants + roadmap), not an
// implementable spec — it is exempt from feature-spec structure rules.
const files = (process.argv.slice(2).length
  ? process.argv.slice(2)
  : readdirSync("specs").filter((f) => /^SPEC-\d{4}.*\.md$/.test(f)).map((f) => join("specs", f))
).filter((f) => !f.includes("SPEC-0000"));

const errors = [];
const idOwners = new Map(); // SPEC id -> [files declaring it]
for (const file of files) {
  const s = readFileSync(file, "utf8");
  const fm = s.match(/^---\n([\s\S]*?)\n---/);
  if (!fm) { errors.push(`${file}: missing YAML frontmatter`); continue; }
  // Normalize one layer of matched surrounding quotes so `id: SPEC-1` and
  // `id: "SPEC-1"` are the same key, not two distinct ones.
  const id = fm[1].match(/^id:\s*(\S+)/m)?.[1]?.replace(/^(['"])(.*)\1$/, "$2");
  if (id) idOwners.set(id, [...(idOwners.get(id) ?? []), file]);
  const status = fm[1].match(/^status:\s*(\S+)/m)?.[1];
  if (!status || !STATUS.has(status)) errors.push(`${file}: status must be one of ${[...STATUS].join("|")} (got: ${status})`);
  for (const k of ["id:", "title:", "milestone:"]) {
    if (!new RegExp(`^${k}`, "m").test(fm[1])) errors.push(`${file}: frontmatter missing ${k.slice(0, -1)}`);
  }
  for (const sec of REQUIRED_SECTIONS) {
    if (!s.includes(sec)) errors.push(`${file}: missing section "${sec}"`);
  }
  // Every Rn mentioned in Requirements must appear in the Test matrix section.
  const reqIds = [...s.matchAll(/^\s*[-*]?\s*\*\*?(R\d+)\b/gm)].map((m) => m[1]);
  const matrix = s.split("## Test matrix")[1]?.split(/\n## /)[0] ?? "";
  for (const r of new Set(reqIds)) {
    if (!matrix.includes(r)) errors.push(`${file}: ${r} has no Test matrix row`);
  }
  // Rejected specs must carry a Tombstone; others must not claim shipped w/o checkboxes.
  if (status === "rejected" && !s.includes("## Tombstone")) errors.push(`${file}: rejected spec missing Tombstone`);
  // Inline type definitions belong in code (AGENTS.md anti-duplication rule).
  if (/^\s*(export\s+)?(interface|type)\s+\w+/m.test(s)) {
    errors.push(`${file}: inline TS type definition found — cite file:line or a zod schema instead`);
  }
}

// One id, one file. Side-session drafts have repeatedly reused a live SPEC
// number (0043, 0046) because the number was free when the branch forked but
// taken by the time it merged; the collision merged silently because this lint
// only checked structure. A rejected/tombstoned spec keeps its id, so a clash
// with an active spec is a real violation the author must renumber.
for (const [id, owners] of idOwners) {
  if (owners.length > 1) {
    errors.push(`duplicate spec id ${id} declared by: ${owners.join(", ")} — renumber all but one`);
  }
}

if (errors.length) {
  console.error(`spec-lint: ${errors.length} violation(s):`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
console.log(`spec-lint: ${files.length} spec(s) OK.`);
