// SPEC-0065 R1 — the pure git-plumbing ref store: write→read round-trip,
// determinism (same payload+endedAt → identical commit SHA across a fresh
// temp git repo), and `receiptRefSlug` edge cases.
import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { listReceiptRefs, readReceiptRef, RECEIPT_REF_PREFIX, receiptRef, writeReceiptRef } from "../../src/pr/store.js";
import { receiptRefSlug } from "../../src/pr/payloadTypes.js";

const dirs: string[] = [];

async function tempRepo(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "aireceipts-store-"));
  dirs.push(dir);
  const init = spawnSync("git", ["init", "--quiet"], { cwd: dir, encoding: "utf8" });
  if (init.status !== 0) {
    throw new Error(`git init failed: ${init.stderr}`);
  }
  return dir;
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("writeReceiptRef / readReceiptRef", () => {
  it("round-trips byte-identical JSON", async () => {
    const cwd = await tempRepo();
    const json = JSON.stringify({ schemaVersion: 1, bodyInput: { a: 1 }, extras: { details: [] } });
    const outcome = writeReceiptRef("feat-x", "feat/x", json, 1_750_000_000_000, cwd);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) {
      return;
    }
    expect(outcome.ref).toBe(`${RECEIPT_REF_PREFIX}feat-x`);
    expect(outcome.commit).toMatch(/^[0-9a-f]{40}$/);

    const readBack = readReceiptRef("feat-x", cwd);
    expect(readBack).toBe(json);
  });

  it("returns null for a slug that was never written", async () => {
    const cwd = await tempRepo();
    expect(readReceiptRef("never-written", cwd)).toBeNull();
  });

  it("lists every written ref by slug", async () => {
    const cwd = await tempRepo();
    writeReceiptRef("feat-a", "feat/a", "{}", 1_000_000, cwd);
    writeReceiptRef("feat-b", "feat/b", "{}", 1_000_000, cwd);

    const refs = listReceiptRefs(cwd);
    const slugs = refs.map((r) => r.slug).sort();
    expect(slugs).toEqual(["feat-a", "feat-b"]);
    expect(refs.every((r) => r.ref === receiptRef(r.slug))).toBe(true);
  });
});

describe("writeReceiptRef determinism", () => {
  it("same (slug, branch, json, endedAtMs) yields the same commit SHA in a fresh repo", async () => {
    const json = JSON.stringify({ schemaVersion: 1, bodyInput: { x: "y" }, extras: {} });
    const endedAtMs = 1_700_000_000_000;

    const repoA = await tempRepo();
    const outcomeA = writeReceiptRef("feat-det", "feat/det", json, endedAtMs, repoA);

    const repoB = await tempRepo();
    const outcomeB = writeReceiptRef("feat-det", "feat/det", json, endedAtMs, repoB);

    expect(outcomeA.ok).toBe(true);
    expect(outcomeB.ok).toBe(true);
    if (!outcomeA.ok || !outcomeB.ok) {
      return;
    }
    expect(outcomeA.commit).toBe(outcomeB.commit);
  });

  it("pins identity, signing, and encoding: hostile GIT_* env + gpgsign + i18n.commitEncoding config do not change the SHA", async () => {
    const json = JSON.stringify({ schemaVersion: 1, bodyInput: {}, extras: {} });
    const endedAtMs = 1_700_000_000_000;

    const clean = await tempRepo();
    const baseline = writeReceiptRef("feat-env", "feat/env", json, endedAtMs, clean);
    expect(baseline.ok).toBe(true);

    const keys = ["GIT_AUTHOR_NAME", "GIT_AUTHOR_EMAIL", "GIT_COMMITTER_NAME", "GIT_COMMITTER_EMAIL"] as const;
    const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
    for (const k of keys) {
      process.env[k] = k.includes("EMAIL") ? "evil@example.com" : "evil";
    }
    try {
      const hostile = await tempRepo();
      spawnSync("git", ["config", "commit.gpgsign", "true"], { cwd: hostile });
      spawnSync("git", ["config", "i18n.commitEncoding", "ISO-8859-1"], { cwd: hostile });
      const outcome = writeReceiptRef("feat-env", "feat/env", json, endedAtMs, hostile);
      expect(outcome.ok).toBe(true);
      if (!outcome.ok || !baseline.ok) {
        return;
      }
      expect(outcome.commit).toBe(baseline.commit);
      const author = spawnSync("git", ["log", "-1", "--format=%an <%ae>", outcome.ref], { cwd: hostile, encoding: "utf8" }).stdout.trim();
      expect(author).toBe("aireceipts <receipts@aireceipts.dev>");
    } finally {
      for (const k of keys) {
        if (saved[k] === undefined) {
          delete process.env[k];
        } else {
          process.env[k] = saved[k];
        }
      }
    }
  });

  it("a different endedAtMs yields a different commit SHA", async () => {
    const json = JSON.stringify({ schemaVersion: 1, bodyInput: {}, extras: {} });

    const repoA = await tempRepo();
    const outcomeA = writeReceiptRef("feat-det2", "feat/det2", json, 1_700_000_000_000, repoA);

    const repoB = await tempRepo();
    const outcomeB = writeReceiptRef("feat-det2", "feat/det2", json, 1_800_000_000_000, repoB);

    expect(outcomeA.ok).toBe(true);
    expect(outcomeB.ok).toBe(true);
    if (!outcomeA.ok || !outcomeB.ok) {
      return;
    }
    expect(outcomeA.commit).not.toBe(outcomeB.commit);
  });
});

describe("receiptRefSlug edge cases", () => {
  it("replaces path separators in a branch name", () => {
    expect(receiptRefSlug("feat/my-feature")).toBe("feat-my-feature");
  });

  it("replaces spaces and unicode with hyphens", () => {
    expect(receiptRefSlug("feat/héllo wörld")).toBe("feat-h-llo-w-rld");
  });

  it("collapses each disallowed character independently (no dedup)", () => {
    expect(receiptRefSlug("a//b")).toBe("a--b");
  });

  it("leaves an already-safe branch name untouched", () => {
    expect(receiptRefSlug("main")).toBe("main");
    expect(receiptRefSlug("feat-0065_v2.1")).toBe("feat-0065_v2.1");
  });

  it("handles an empty string", () => {
    expect(receiptRefSlug("")).toBe("");
  });
});
