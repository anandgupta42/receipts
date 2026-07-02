import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  checkGitleaksIgnoreText,
  checkLineBudgets,
  checkPrTitle,
  checkRootAllowlist,
  formatFalsePositiveEntry,
  isFalsePositiveEntry,
  LINE_BUDGETS,
  ROOT_ALLOWLIST,
  runHygiene,
} from "../scripts/hygiene.mjs";

function withTempRoot(files: Record<string, string>, fn: (root: string) => void) {
  const root = mkdtempSync(join(tmpdir(), "aireceipts-hygiene-"));
  try {
    for (const [file, contents] of Object.entries(files)) {
      writeFileSync(join(root, file), contents);
    }
    fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe("repo hygiene gates", () => {
  it("R1 fails when AGENTS.md exceeds the constitution budget", () => {
    withTempRoot(
      {
        "AGENTS.md": Array.from({ length: 151 }, (_, index) => `line ${index + 1}`).join("\n"),
        "CLAUDE.md": "See AGENTS.md\n",
      },
      (root) => {
        expect(checkLineBudgets(root)).toEqual([
          expect.stringContaining("AGENTS.md: 151 lines exceeds 150-line budget"),
        ]);
      },
    );
  });

  it("R1 fails when CLAUDE.md grows past pointer size", () => {
    withTempRoot(
      {
        "AGENTS.md": "ok\n",
        "CLAUDE.md": "one\ntwo\nthree\nfour\n",
      },
      (root) => {
        expect(checkLineBudgets(root)).toEqual([
          expect.stringContaining("CLAUDE.md: 4 lines exceeds 3-line budget"),
        ]);
      },
    );
  });

  it("R2 fails on unexpected tracked root entries and names the move-or-delete rule", () => {
    expect(checkRootAllowlist(["debug-notes.md"])).toEqual([
      expect.stringContaining("agents treat root files as authoritative — move it to docs/ or delete it"),
    ]);
  });

  it("R2 allows the current tracked root set", () => {
    const tracked = execFileSync("git", ["ls-files"], { encoding: "utf8" }).split("\n").filter(Boolean);
    expect(checkRootAllowlist(tracked)).toEqual([]);
  });

  it("R3 accepts and rejects the specified PR title shapes", () => {
    expect(checkPrTitle("updates")).toEqual([expect.stringContaining("type(scope)?: subject")]);
    expect(checkPrTitle(`feat: ${"x".repeat(80)}`)).toEqual([
      expect.stringContaining("maximum is 72"),
    ]);
    expect(checkPrTitle("feat: ok")).toEqual([]);
  });

  it("R3 rejects the finite banned phrase list case-insensitively", () => {
    expect(checkPrTitle("docs: explain altimate launch copy")).toEqual([
      expect.stringContaining("founder, Altimate"),
    ]);
  });

  it("R4 determinism harness passes stable output and fails drift-injection output", () => {
    const stable = spawnSync(
      "node",
      ["scripts/determinism-check.mjs", "--runs=2", "--", "node", "-e", "console.log('stable')"],
      { encoding: "utf8" },
    );
    expect(stable.status).toBe(0);

    const drift = spawnSync(
      "node",
      [
        "scripts/determinism-check.mjs",
        "--runs=2",
        "--",
        "node",
        "-e",
        "console.log(process.hrtime.bigint().toString())",
      ],
      { encoding: "utf8" },
    );
    expect(drift.status).toBe(1);
    expect(drift.stderr).toContain("DRIFT");
  });

  it("R5 is wired to pinned, checksum-verified actionlint without latest", () => {
    const workflow = readFileSync(".github/workflows/hygiene.yml", "utf8");
    expect(workflow).toContain('ACTIONLINT_VERSION: "1.7.7"');
    expect(workflow).toContain("actionlint_${ACTIONLINT_VERSION}_checksums.txt");
    expect(workflow).toContain("sha256sum -c -");
    expect(workflow).toContain("find .github/workflows -maxdepth 1");
    expect(workflow).toContain('"${RUNNER_TEMP}/actionlint/actionlint" "${files[@]}"');
    expect(workflow).not.toContain('ACTIONLINT_VERSION: "latest"');
    expect(workflow).not.toContain("/download/latest/");
  });

  it("R6 is wired to the MIT gitleaks CLI, not gitleaks-action", () => {
    const workflow = readFileSync(".github/workflows/hygiene.yml", "utf8");
    expect(workflow).toContain('GITLEAKS_VERSION: "8.24.3"');
    expect(workflow).toContain("gitleaks_${GITLEAKS_VERSION}_checksums.txt");
    expect(workflow).toContain('"${RUNNER_TEMP}/gitleaks/gitleaks" git --log-opts="${BASE_SHA}..HEAD"');
    expect(workflow).toContain('"${RUNNER_TEMP}/gitleaks/gitleaks" git --log-opts="--all"');
    expect(workflow).not.toContain("gitleaks-action");
  });

  it("R6 suppression governance requires # reason comments in .gitleaksignore", () => {
    expect(checkGitleaksIgnoreText("abc123\n")).toEqual([
      '.gitleaksignore:1: suppression entry requires a preceding "# reason:" comment',
    ]);
    expect(checkGitleaksIgnoreText("# reason: fixture fingerprint\nabc123\n")).toEqual([]);
  });

  it("R8 documents and formats false-positive log entries", () => {
    const entry = formatFalsePositiveEntry({
      date: "2026-07-02",
      gate: "actionlint",
      cause: "runner label false positive",
      action: "updated allowlist",
    });
    const log = readFileSync("docs/internal/hygiene-fp-log.md", "utf8");

    expect(entry).toBe("2026-07-02 · actionlint · runner label false positive · updated allowlist");
    expect(isFalsePositiveEntry(entry)).toBe(true);
    expect(log).toContain("YYYY-MM-DD · gate · cause · action");
    expect(log).toContain("_No entries._");
  });

  it("R7 keeps local and CI checks on the same script/rules module", () => {
    const workflow = readFileSync(".github/workflows/hygiene.yml", "utf8");
    const ci = readFileSync(".github/workflows/ci.yml", "utf8");

    expect(LINE_BUDGETS.map((budget) => budget.file)).toEqual(["AGENTS.md", "CLAUDE.md"]);
    expect(ROOT_ALLOWLIST).toContain("scripts");
    expect(workflow).toContain("node scripts/hygiene.mjs");
    expect(ci).toContain("node scripts/determinism-check.mjs --runs=10 -- node scripts/verify-goldens.mjs");
    expect(runHygiene({ trackedFiles: ["AGENTS.md", "scripts/hygiene.mjs"] })).toEqual([]);
  });
});
