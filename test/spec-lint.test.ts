// spec-lint's duplicate-id guard. Two spec files declaring the same `id:`
// must fail the lint — the side-session collision (0043, 0046) that merged
// silently green because the lint only checked structure.
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

function fixture(id: string): string {
  return `---
id: ${id}
title: "lint fixture"
status: draft
milestone: M9
depends: []
---

# ${id}: lint fixture

## Purpose
Fixture for the duplicate-id guard.

## Requirements
None.

## Non-goals
None.

## Test matrix
| Case | Input | Expected |
|---|---|---|
| a | b | c |

## Success criteria
- [ ] n/a
`;
}

function runLint(...files: string[]): { status: number; stderr: string } {
  const r = spawnSync("node", ["scripts/spec-lint.mjs", ...files], { encoding: "utf8" });
  return { status: r.status ?? 1, stderr: r.stderr + r.stdout };
}

describe("spec-lint duplicate-id guard", () => {
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "aireceipts-spec-lint-"));
  });
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("fails when two specs declare the same id, and names both files", () => {
    const a = join(dir, "SPEC-9001-alpha.md");
    const b = join(dir, "SPEC-9001-beta.md");
    writeFileSync(a, fixture("SPEC-9001"));
    writeFileSync(b, fixture("SPEC-9001"));
    const { status, stderr } = runLint(a, b);
    expect(status).not.toBe(0);
    expect(stderr).toContain("duplicate spec id SPEC-9001");
    expect(stderr).toContain("SPEC-9001-alpha.md");
    expect(stderr).toContain("SPEC-9001-beta.md");
  });

  it("treats a quoted id as equal to its unquoted twin", () => {
    const a = join(dir, "SPEC-9004-alpha.md");
    const b = join(dir, "SPEC-9004-beta.md");
    writeFileSync(a, fixture("SPEC-9004"));
    writeFileSync(b, fixture('"SPEC-9004"'));
    const { status, stderr } = runLint(a, b);
    expect(status).not.toBe(0);
    expect(stderr).toContain("duplicate spec id SPEC-9004");
  });

  it("passes when ids are distinct", () => {
    const a = join(dir, "SPEC-9002-alpha.md");
    const b = join(dir, "SPEC-9003-beta.md");
    writeFileSync(a, fixture("SPEC-9002"));
    writeFileSync(b, fixture("SPEC-9003"));
    const { status } = runLint(a, b);
    expect(status).toBe(0);
  });

  it("the committed spec tree has no duplicate ids", () => {
    const { status } = runLint();
    expect(status).toBe(0);
  });
});
