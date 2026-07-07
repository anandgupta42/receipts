// SPEC-0065 R2 — the committed `.githooks/pre-push` hook: the branch-push
// recursion guard, the exact CLI invocation it runs, and that every exit path
// is `exit 0` (it must never block `git push`). Plus a unit test that the
// `--push-ref` flag parses into `CliOptions.pushRef` (SPEC-0065 R2).
import { fileURLToPath } from "node:url";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseOptions } from "../../src/cli/options.js";
import { command as prCommand } from "../../src/cli/commands/pr.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const HOOK_PATH = path.join(ROOT, ".githooks", "pre-push");
const hook = readFileSync(HOOK_PATH, "utf8");

/**
 * Runs the real hook in a throwaway git repo with a fake `dist/cli.js` that drops a
 * marker file, and returns whether the guard let the push through (marker written).
 * Proves branch detection + recursion safety without invoking the real CLI.
 */
function hookActedOn(stdin: string): boolean {
  const dir = mkdtempSync(path.join(tmpdir(), "aireceipts-hook-"));
  try {
    spawnSync("git", ["init", "-q"], { cwd: dir });
    mkdirSync(path.join(dir, "dist"), { recursive: true });
    const marker = path.join(dir, "RAN");
    writeFileSync(path.join(dir, "dist", "cli.js"), `require("node:fs").writeFileSync(${JSON.stringify(marker)}, "1");`);
    spawnSync("sh", [HOOK_PATH], { cwd: dir, input: stdin });
    return existsSync(marker);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("SPEC-0065 R2 .githooks/pre-push", () => {
  it("is a POSIX sh script", () => {
    expect(hook.startsWith("#!/bin/sh")).toBe(true);
  });

  it("guards on refs/heads/* from stdin before doing anything", () => {
    expect(hook).toContain("refs/heads/*");
  });

  it("runs the CLI with --store ref --push-ref (no shell-side slug computation)", () => {
    expect(hook).toContain("pr --store ref --push-ref");
    // The hook must delegate slug derivation entirely to the CLI (which shares
    // `receiptRefSlug` with CI, per SPEC-0066's seam contract) rather than
    // deriving a branch-name-to-slug transform itself, which would drift.
    expect(hook).not.toMatch(/\btr\b|\bsed\b|receiptRefSlug/);
  });

  it("every exit path is `exit 0` — the hook never blocks the push", () => {
    const exits = hook.match(/exit\s+\d+/g) ?? [];
    expect(exits.length).toBeGreaterThan(0);
    expect(exits.every((e) => e === "exit 0")).toBe(true);
  });

  it("the CLI invocation is best-effort: output is discarded and failures are swallowed", () => {
    expect(hook).toContain(">/dev/null 2>&1 || true");
  });

  it("falls back through node dist/cli.js, then a PATH-installed aireceipts, without ever failing hard", () => {
    expect(hook).toContain("dist/cli.js");
    expect(hook).toContain("command -v aireceipts");
  });

  it("acts on a branch push whether the branch is the local ref or only the remote ref", () => {
    // normal push: branch named on both sides
    expect(hookActedOn("refs/heads/feat 111 refs/heads/feat 111\n")).toBe(true);
    // `git push origin HEAD^:refs/heads/main` — the branch is named only on the remote side
    expect(hookActedOn("HEAD^ 111 refs/heads/main 111\n")).toBe(true);
  });

  it("does NOT act on a ref-only receipts push — the recursion guard holds", () => {
    expect(hookActedOn("refs/receipts/feat 222 refs/receipts/feat 222\n")).toBe(false);
  });
});

describe("SPEC-0065 R2 --push-ref CLI surface", () => {
  it("parses aireceipts pr --store ref --push-ref", () => {
    const opts = parseOptions(["pr", "--store", "ref", "--push-ref"]);
    expect(opts.store).toBe("ref");
    expect(opts.pushRef).toBe(true);
  });

  it("defaults to pushRef=false (opt-in, never implied by --store ref alone)", () => {
    expect(parseOptions(["pr", "--store", "ref"]).pushRef).toBe(false);
  });

  it("lists --push-ref in the pr command's help text", () => {
    expect(prCommand.help.lines.join("\n")).toContain("--push-ref");
  });
});
