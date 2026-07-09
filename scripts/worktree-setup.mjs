#!/usr/bin/env node
// One-shot bootstrap for a git worktree of this repo.
//
//   npm run setup:worktree
//
// Two things a fresh worktree lacks that make gates fail confusingly:
//   1. No node_modules. npm/npx resolve up-tree to the main checkout's copy, so
//      tsc/eslint/tsup work — but scripts with a hardcoded `node_modules/…` path
//      (verify-goldens.mjs wants node_modules/typescript/bin/tsc) and `vitest`
//      do NOT, and fail spuriously. We symlink the main checkout's node_modules.
//   2. A stale local main. We fetch origin/main so a branch forks from current.
//
// Idempotent: safe to re-run. No-op in the main checkout.
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, symlinkSync } from "node:fs";
import { dirname, join } from "node:path";

const run = (cmd, args) => execFileSync(cmd, args, { encoding: "utf8" }).trim();

// Absolute path to the shared .git dir → its parent is the main checkout root.
const gitCommonDir = run("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
const mainRoot = dirname(gitCommonDir);
const toplevel = run("git", ["rev-parse", "--show-toplevel"]);

if (mainRoot === toplevel) {
  console.log("This is the main checkout, not a linked worktree — nothing to link.");
} else {
  const localModules = join(toplevel, "node_modules");
  const mainModules = join(mainRoot, "node_modules");
  if (existsSync(localModules) || isSymlink(localModules)) {
    console.log(`node_modules already present (${localModules}) — leaving it.`);
  } else if (!existsSync(mainModules)) {
    console.error(`Main checkout has no node_modules (${mainModules}). Run 'npm install' there first.`);
    process.exit(1);
  } else {
    symlinkSync(mainModules, localModules);
    console.log(`Linked node_modules → ${mainModules}`);
  }
}

try {
  run("git", ["fetch", "origin", "main"]);
  console.log("Fetched origin/main (branch from it: git checkout -b <name> origin/main).");
} catch (e) {
  console.warn(`Could not fetch origin/main: ${e.message}`);
}

function isSymlink(p) {
  try {
    return lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
}
