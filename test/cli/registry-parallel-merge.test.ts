// SPEC-0018 R5: the parallel-safety proof, using git rather than synthetic
// assertions. Two branches each add one command module (the way a real
// contributor's spec would); we merge both into the same baseline and assert git
// reports no conflict AND the merged diff touches exactly the two new command
// files and their tests — no args.ts, index.ts, registry.ts, options.ts, help.ts,
// or any other central funnel. This is the kill criterion for the shared-file
// merge collision the registry removes.
import { cpSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const REAL_SRC_CLI = resolve(dirname(fileURLToPath(import.meta.url)), "../../src/cli");

/** Run git in `cwd` with a hermetic identity; returns {status, stdout}. Throws on unexpected failure when `mustPass`. */
function git(cwd: string, args: string[], mustPass = true): { status: number; stdout: string } {
  const res = spawnSync(
    "git",
    ["-c", "user.email=test@aireceipts.dev", "-c", "user.name=test", "-c", "commit.gpgsign=false", ...args],
    { cwd, encoding: "utf8" },
  );
  if (mustPass && res.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed:\n${res.stdout}\n${res.stderr}`);
  }
  return { status: res.status ?? 1, stdout: res.stdout };
}

const COMMAND_MODULE = (name: string, priority: number) => `import type { CommandContext, CommandDef } from "../types.js";

function run(ctx: CommandContext): number {
  ctx.stdout.write("${name}\\n");
  return 0;
}

export const command: CommandDef = {
  name: "${name}",
  priority: ${priority},
  matches: (options) => options.positional[0] === "${name}",
  run,
  help: { order: ${priority}, lines: ["  aireceipts ${name}                       demo command ${name}"] },
};
`;

const COMMAND_TEST = (name: string) => `import { describe, expect, it } from "vitest";
import { command } from "../../src/cli/commands/${name}.js";

describe("${name} command", () => {
  it("is self-selecting on its own positional", () => {
    expect(command.name).toBe("${name}");
  });
});
`;

describe("SPEC-0018 R5 · two commands added in parallel merge conflict-free", () => {
  let repo: string;

  beforeEach(() => {
    repo = mkdtempSync(resolve(tmpdir(), "aireceipts-r5-"));
    // Baseline = the REAL registry tree, so "no shared file changed" is a
    // meaningful assertion about the actual command-registry design.
    cpSync(REAL_SRC_CLI, resolve(repo, "src/cli"), { recursive: true });
    mkdirSync(resolve(repo, "test/cli"), { recursive: true });
    writeFileSync(resolve(repo, "test/cli/.gitkeep"), "");
    git(repo, ["init", "-q", "-b", "main"]);
    git(repo, ["add", "-A"]);
    git(repo, ["commit", "-q", "-m", "baseline: real src/cli registry"]);
  });

  afterEach(() => {
    rmSync(repo, { recursive: true, force: true });
  });

  it("merges branch A (alpha) and branch B (beta) with no conflict and a disjoint diff", () => {
    const base = git(repo, ["rev-parse", "HEAD"]).stdout.trim();

    // Branch A adds only its own command module + test.
    git(repo, ["checkout", "-q", "-b", "feat-alpha"]);
    writeFileSync(resolve(repo, "src/cli/commands/alpha.ts"), COMMAND_MODULE("alpha", 45));
    writeFileSync(resolve(repo, "test/cli/alpha.test.ts"), COMMAND_TEST("alpha"));
    git(repo, ["add", "-A"]);
    git(repo, ["commit", "-q", "-m", "feat: alpha command"]);

    // Branch B, from the same baseline, adds only its own command module + test.
    git(repo, ["checkout", "-q", "main"]);
    git(repo, ["checkout", "-q", "-b", "feat-beta"]);
    writeFileSync(resolve(repo, "src/cli/commands/beta.ts"), COMMAND_MODULE("beta", 46));
    writeFileSync(resolve(repo, "test/cli/beta.test.ts"), COMMAND_TEST("beta"));
    git(repo, ["add", "-A"]);
    git(repo, ["commit", "-q", "-m", "feat: beta command"]);

    // Merge both into main. Neither merge may conflict.
    git(repo, ["checkout", "-q", "main"]);
    const mergeA = git(repo, ["merge", "--no-edit", "feat-alpha"], false);
    expect(mergeA.status).toBe(0);
    const mergeB = git(repo, ["merge", "--no-edit", "feat-beta"], false);
    expect(mergeB.status).toBe(0);

    // The exact promised changed-file set: the two commands + their tests, nothing else.
    const changed = git(repo, ["diff", "--name-only", base, "HEAD"]).stdout
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean)
      .sort();
    expect(changed).toEqual([
      "src/cli/commands/alpha.ts",
      "src/cli/commands/beta.ts",
      "test/cli/alpha.test.ts",
      "test/cli/beta.test.ts",
    ]);

    // No central funnel was touched by either branch.
    const FUNNELS = [
      "src/cli/args.ts",
      "src/cli/index.ts",
      "src/cli/registry.ts",
      "src/cli/options.ts",
      "src/cli/help.ts",
      "src/cli/context.ts",
      "src/cli/types.ts",
    ];
    for (const funnel of FUNNELS) {
      expect(changed).not.toContain(funnel);
    }
  });

  it("the registry carries no committed per-command import list", () => {
    // Structural backstop for R1: the discovery module must not name individual
    // commands (an import list would be the funnel two branches collide on).
    const registry = spawnSync("cat", [resolve(REAL_SRC_CLI, "registry.ts")], { encoding: "utf8" }).stdout;
    for (const name of ["receipt", "compare", "handoff", "week", "install-hook", "statusline"]) {
      expect(registry).not.toContain(`commands/${name}`);
    }
  });
});
