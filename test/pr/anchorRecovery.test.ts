// SPEC-0072 - patch-id recovery for orphaned commit anchors. These tests use
// real temporary git repositories so the stable patch-id boundary is exercised
// against local git object state, not a mocked fingerprint.
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { AgentSource, Session, SessionSummary, Turn } from "../../src/parse/types.js";
import { emptyUsage, withTotal } from "../../src/parse/util.js";
import { sliceSessionForReceipt } from "../../src/receipt/model.js";
import { defaultRunner } from "../../src/pr/git.js";
import { selectContributors, type PoolCandidate } from "../../src/pr/contributors.js";
import { summarizeConfidence } from "../../src/pr/confidence.js";
import { rollupChildren } from "../../src/pr/rollup.js";

const dirs: string[] = [];
const usage = withTotal({ ...emptyUsage(), input: 1000, output: 100 });

async function tempRepo(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "aireceipts-anchor-"));
  dirs.push(dir);
  git(dir, ["init", "--quiet"]);
  git(dir, ["config", "user.email", "tests@example.com"]);
  git(dir, ["config", "user.name", "Receipt Tests"]);
  git(dir, ["config", "commit.gpgsign", "false"]);
  await writeFile(join(dir, "README.md"), "base\n");
  git(dir, ["add", "README.md"]);
  git(dir, ["commit", "--quiet", "-m", "base"]);
  return dir;
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function git(cwd: string, args: string[], input?: string): string {
  const res = spawnSync("git", args, { cwd, input, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  if (res.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${res.stderr}`);
  }
  return res.stdout.trim();
}

function currentBranch(cwd: string): string {
  return git(cwd, ["branch", "--show-current"]);
}

function head(cwd: string): string {
  return git(cwd, ["rev-parse", "HEAD"]);
}

async function commitFile(cwd: string, file: string, content: string, subject: string): Promise<string> {
  await writeFile(join(cwd, file), content);
  git(cwd, ["add", file]);
  git(cwd, ["commit", "--quiet", "-m", subject]);
  return head(cwd);
}

function commitOutput(sha: string, subject: string): string {
  return `[feat ${sha.slice(0, 7)}] ${subject}\n 1 file changed`;
}

function bashTurn(index: number, command: string, output: string): Turn {
  return {
    index,
    timestamp: 1000 + index,
    model: "claude-opus-4-8",
    usage,
    toolCalls: [{ name: "Bash", shell: true, input: { command }, output, status: "ok" }],
  };
}

function makeSession(
  id: string,
  cwd: string,
  turns: Turn[],
  source: AgentSource = "claude-code",
  startedAt = 1000,
): Session {
  return {
    id,
    source,
    filePath: `${cwd}/${id}.jsonl`,
    cwd,
    startedAt,
    endedAt: startedAt + 1000,
    totals: { tokens: usage, turnCount: turns.length, toolCallCount: turns.length },
    turns,
  };
}

function repo(s: Session): PoolCandidate {
  return { summary: s, pool: "repo" };
}

function anchor(s: Session): PoolCandidate {
  return { summary: s, pool: "anchor" };
}

function depsFor(cwd: string, sessions: Session[], branchSubjects: readonly string[] = []) {
  const byId = new Map(sessions.map((s) => [s.id, s]));
  return {
    loadSession: async (summary: SessionSummary) => byId.get(summary.id) ?? null,
    currentWorktreeRoot: cwd,
    branchSubjects,
    runGit: defaultRunner,
  };
}

async function amendRepo(changeContent: boolean): Promise<{ cwd: string; oldSha: string; newSha: string }> {
  const cwd = await tempRepo();
  await commitFile(cwd, "feature.txt", "one\n", "feat: original change");
  const oldSha = head(cwd);
  if (changeContent) {
    await writeFile(join(cwd, "feature.txt"), "two\n");
    git(cwd, ["add", "feature.txt"]);
  }
  git(cwd, ["commit", "--amend", "--quiet", "-m", "feat: amended branch change"]);
  return { cwd, oldSha, newSha: head(cwd) };
}

async function duplicatePatchRepo(): Promise<{ cwd: string; firstSha: string; revertSha: string; reapplySha: string; orphanSha: string }> {
  const cwd = await tempRepo();
  const main = currentBranch(cwd);
  git(cwd, ["checkout", "--quiet", "-b", "orphan"]);
  const orphanSha = await commitFile(cwd, "dup.txt", "same\n", "feat: orphan duplicate");
  git(cwd, ["checkout", "--quiet", main]);
  const firstSha = await commitFile(cwd, "dup.txt", "same\n", "feat: add duplicate");
  git(cwd, ["revert", "--quiet", "--no-edit", firstSha]);
  const revertSha = head(cwd);
  const reapplySha = await commitFile(cwd, "dup.txt", "same\n", "feat: reapply duplicate");
  return { cwd, firstSha, revertSha, reapplySha, orphanSha };
}

describe("SPEC-0072 R1 - patch-id anchor recovery", () => {
  it("keeps pre-amend work when an in-session commit is amended", async () => {
    const { cwd, oldSha, newSha } = await amendRepo(false);
    const s = makeSession("amended-in-session", cwd, [
      bashTurn(0, "npm test", "tests passed"),
      bashTurn(1, "git commit -m original", commitOutput(oldSha, "feat: original change")),
      bashTurn(2, "git commit --amend -m amended", commitOutput(newSha, "feat: amended branch change")),
    ]);

    const sel = await selectContributors([repo(s)], [newSha], depsFor(cwd, [s]));

    expect(sel.contributors).toHaveLength(1);
    const slice = sel.contributors[0].slice;
    expect(slice).toEqual({ kind: "slice", startTurn: 0, endTurn: 2, turnCount: 3 });
    expect(sel.excludedCount).toBe(0);

    if (slice.kind !== "slice") {
      throw new Error("expected amended session to be sliceable");
    }
    const rendered = sliceSessionForReceipt(s, slice);
    const child = makeSession("child", cwd, [bashTurn(0, "npm test", "child tests passed")]);
    const rows = await rollupChildren(s.filePath, { start: rendered.startedAt!, end: rendered.endedAt! }, {
      discover: async () => [child.filePath],
      load: async () => child,
    });
    expect(rows.map((row) => row.filePath)).toEqual([child.filePath]);
  });

  it("credits a message-only amend by matching the orphan SHA's stable patch-id", async () => {
    const { cwd, oldSha, newSha } = await amendRepo(false);
    const s = makeSession("amended", cwd, [bashTurn(0, "git commit -m original", commitOutput(oldSha, "feat: original change"))]);

    const sel = await selectContributors([repo(s)], [newSha], depsFor(cwd, [s]));

    expect(sel.contributors.map((c) => [c.summary.id, c.basis])).toEqual([["amended", "anchor"]]);
    expect(sel.contributors[0].slice).toEqual({ kind: "slice", startTurn: 0, endTurn: 0, turnCount: 1 });
    expect(sel.excludedCount).toBe(0);
  });

  it("credits a recovered-only anchor-pool session with a precise slice", async () => {
    const { cwd, oldSha, newSha } = await amendRepo(false);
    const s = makeSession("anchor-pool-amended", cwd, [
      bashTurn(0, "npm test", "tests passed"),
      bashTurn(1, "git commit -m original", commitOutput(oldSha, "feat: original change")),
    ]);

    const sel = await selectContributors([anchor(s)], [newSha], depsFor(cwd, [s]));

    expect(sel.contributors).toHaveLength(1);
    expect(sel.contributors[0]).toMatchObject({
      basis: "anchor",
      slice: { kind: "slice", startTurn: 0, endTurn: 1, turnCount: 2 },
    });
    expect(summarizeConfidence(sel.events).unattributableAnchorPool).toBe(0);
  });

  it("keeps a genuine foreign commit as the boundary before a recovered amend", async () => {
    const cwd = await tempRepo();
    const main = currentBranch(cwd);
    git(cwd, ["checkout", "--quiet", "-b", "foreign"]);
    const foreignSha = await commitFile(cwd, "foreign.txt", "foreign\n", "feat: foreign change");
    git(cwd, ["checkout", "--quiet", main]);
    const oldSha = await commitFile(cwd, "feature.txt", "one\n", "feat: original change");
    git(cwd, ["commit", "--amend", "--quiet", "-m", "feat: amended branch change"]);
    const newSha = head(cwd);
    const s = makeSession("foreign-then-amended", cwd, [
      bashTurn(0, "git commit -m foreign", commitOutput(foreignSha, "feat: foreign change")),
      bashTurn(1, "npm test", "tests passed"),
      bashTurn(2, "git commit -m original", commitOutput(oldSha, "feat: original change")),
      bashTurn(3, "git commit --amend -m amended", commitOutput(newSha, "feat: amended branch change")),
    ]);

    const sel = await selectContributors([repo(s)], [newSha], depsFor(cwd, [s]));

    expect(sel.contributors).toHaveLength(1);
    expect(sel.contributors[0].slice).toEqual({ kind: "slice", startTurn: 1, endTurn: 3, turnCount: 4 });
  });

  it("keeps all work across multiple direct commits followed by an amend", async () => {
    const cwd = await tempRepo();
    const firstSha = await commitFile(cwd, "first.txt", "first\n", "feat: first change");
    const oldSha = await commitFile(cwd, "feature.txt", "one\n", "feat: original change");
    git(cwd, ["commit", "--amend", "--quiet", "-m", "feat: amended branch change"]);
    const newSha = head(cwd);
    const s = makeSession("multiple-then-amended", cwd, [
      bashTurn(0, "npm test", "tests passed"),
      bashTurn(1, "git commit -m first", commitOutput(firstSha, "feat: first change")),
      bashTurn(2, "npm run lint", "lint passed"),
      bashTurn(3, "git commit -m original", commitOutput(oldSha, "feat: original change")),
      bashTurn(4, "git commit --amend -m amended", commitOutput(newSha, "feat: amended branch change")),
    ]);

    const sel = await selectContributors([repo(s)], [newSha, firstSha], depsFor(cwd, [s]));

    expect(sel.contributors).toHaveLength(1);
    expect(sel.contributors[0].slice).toEqual({ kind: "slice", startTurn: 0, endTurn: 4, turnCount: 5 });
  });

  it("does not credit a content-changing amend whose patch-id differs", async () => {
    const { cwd, oldSha, newSha } = await amendRepo(true);
    const s = makeSession("changed", cwd, [bashTurn(0, "git commit -m original", commitOutput(oldSha, "feat: original change"))]);

    const sel = await selectContributors([repo(s)], [newSha], depsFor(cwd, [s]));

    expect(sel.contributors).toHaveLength(0);
    expect(sel.excludedCount).toBe(1);
    const confidence = summarizeConfidence(sel.events);
    expect(confidence.unanchoredGitWrite).toBe(1);
    expect(confidence.silencedGitWrite).toBe(0);
  });

  it("keeps pre-amend work for a content-changing amend when the same session prints final B", async () => {
    const { cwd, oldSha, newSha } = await amendRepo(true);
    const s = makeSession("changed-with-final", cwd, [
      bashTurn(0, "npm test", "tests passed"),
      bashTurn(1, "git commit -m original", commitOutput(oldSha, "feat: original change")),
      bashTurn(2, "git commit --amend -m changed", commitOutput(newSha, "feat: changed amend")),
    ]);

    const sel = await selectContributors([repo(s)], [newSha], depsFor(cwd, [s]));

    expect(sel.contributors).toHaveLength(1);
    expect(sel.contributors[0].slice).toEqual({ kind: "slice", startTurn: 0, endTurn: 2, turnCount: 3 });
    expect(sel.events).toEqual([]);
  });

  it("skips an unresolvable orphan object without crashing", async () => {
    const cwd = await tempRepo();
    const branchSha = await commitFile(cwd, "branch.txt", "branch\n", "feat: branch");
    const missing = "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef";
    const s = makeSession("missing", cwd, [bashTurn(0, "git commit -m missing", commitOutput(missing, "feat: missing"))]);

    const sel = await selectContributors([repo(s)], [branchSha], depsFor(cwd, [s]));

    expect(sel.contributors).toHaveLength(0);
    expect(summarizeConfidence(sel.events).unanchoredGitWrite).toBe(1);
  });

  it("refuses duplicate branch diffs even when none are directly claimed", async () => {
    const { cwd, firstSha, revertSha, reapplySha, orphanSha } = await duplicatePatchRepo();
    const s = makeSession("orphan", cwd, [bashTurn(0, "git commit -m duplicate", commitOutput(orphanSha, "feat: orphan duplicate"))]);

    const sel = await selectContributors([repo(s)], [reapplySha, revertSha, firstSha], depsFor(cwd, [s]));

    expect(sel.contributors).toHaveLength(0);
    expect(summarizeConfidence(sel.events).unanchoredGitWrite).toBe(1);
  });

  it("refuses duplicate branch diffs even when one duplicate is already direct-claimed", async () => {
    const { cwd, firstSha, revertSha, reapplySha, orphanSha } = await duplicatePatchRepo();
    const direct = makeSession("direct", cwd, [bashTurn(0, "git commit -m direct", commitOutput(firstSha, "feat: add duplicate"))], "claude-code", 2000);
    const orphan = makeSession("orphan", cwd, [bashTurn(0, "git commit -m duplicate", commitOutput(orphanSha, "feat: orphan duplicate"))], "claude-code", 1000);

    const sel = await selectContributors([repo(orphan), repo(direct)], [reapplySha, revertSha, firstSha], depsFor(cwd, [direct, orphan]));

    expect(sel.contributors.map((c) => c.summary.id)).toEqual(["direct"]);
    expect(sel.excludedCount).toBe(1);
  });

  it("does not credit a session that cherry-picked another session's already-claimed unique commit", async () => {
    // Authorship guard: patch-id proves diff-equality, not authorship. Session `author`
    // lands a unique-diff commit (direct SHA claim); session `cherry` reproduces the exact
    // diff as a local orphan (cherry-pick) — its own commit output reports the new SHA.
    // The orphan's patch-id is unique among the observed branch/orphan sets, so without the
    // guard it would be promoted onto the author's SHA and bill the cherry session's whole
    // work to the PR. It must stay uncredited (I2).
    const cwd = await tempRepo();
    const main = currentBranch(cwd);
    const branchSha = await commitFile(cwd, "shared.txt", "shared change\n", "feat: shared change");
    // Cherry-pick onto a DIFFERENT parent (an unrelated commit) so the orphan gets a
    // distinct SHA while keeping the identical diff (equal patch-id). Cherry-picking the
    // tip straight onto its own parent would reproduce the byte-identical commit SHA and
    // never exercise the guard.
    git(cwd, ["checkout", "--quiet", "-b", "cherry", `${branchSha}~1`]);
    await commitFile(cwd, "unrelated.txt", "noise\n", "chore: unrelated work");
    git(cwd, ["cherry-pick", "--no-edit", branchSha]);
    const orphanSha = head(cwd);
    expect(orphanSha).not.toBe(branchSha);
    git(cwd, ["checkout", "--quiet", main]);

    const author = makeSession("author", cwd, [bashTurn(0, "git commit -m shared", commitOutput(branchSha, "feat: shared change"))], "claude-code", 1000);
    const cherry = makeSession("cherry", cwd, [bashTurn(0, "git commit -m mine", commitOutput(orphanSha, "feat: mine"))], "claude-code", 2000);

    const sel = await selectContributors([repo(author), repo(cherry)], [branchSha], depsFor(cwd, [author, cherry]));

    expect(sel.contributors.map((c) => c.summary.id)).toEqual(["author"]);
    expect(summarizeConfidence(sel.events).unanchoredGitWrite).toBe(1);
  });

  it("excludes empty commit targets and orphans from recovery", async () => {
    const cwd = await tempRepo();
    const main = currentBranch(cwd);
    git(cwd, ["checkout", "--quiet", "-b", "empty-orphan"]);
    git(cwd, ["commit", "--quiet", "--allow-empty", "-m", "empty orphan"]);
    const orphanSha = head(cwd);
    git(cwd, ["checkout", "--quiet", main]);
    git(cwd, ["commit", "--quiet", "--allow-empty", "-m", "empty target"]);
    const targetSha = head(cwd);
    const s = makeSession("empty", cwd, [bashTurn(0, "git commit --allow-empty -m empty", commitOutput(orphanSha, "empty orphan"))]);

    const sel = await selectContributors([repo(s)], [targetSha], depsFor(cwd, [s]));

    expect(sel.contributors).toHaveLength(0);
    expect(summarizeConfidence(sel.events).unanchoredGitWrite).toBe(1);
  });

  it("excludes merge commits as recovery targets", async () => {
    const cwd = await tempRepo();
    const main = currentBranch(cwd);
    git(cwd, ["checkout", "--quiet", "-b", "side"]);
    const sideSha = await commitFile(cwd, "side.txt", "side\n", "feat: side");
    git(cwd, ["checkout", "--quiet", main]);
    await commitFile(cwd, "main.txt", "main\n", "feat: main");
    git(cwd, ["merge", "--quiet", "--no-ff", "-m", "merge side", "side"]);
    const mergeSha = head(cwd);
    const s = makeSession("merge-target", cwd, [bashTurn(0, "git commit -m side", commitOutput(sideSha, "feat: side"))]);

    const sel = await selectContributors([repo(s)], [mergeSha], depsFor(cwd, [s]));

    expect(sel.contributors).toHaveLength(0);
    expect(summarizeConfidence(sel.events).unanchoredGitWrite).toBe(1);
  });

  it("is independent of candidate order and recovered claims poison message fallback", async () => {
    const { cwd, oldSha, newSha } = await amendRepo(false);
    const branchSubject = "feat: amended branch change";
    const recovered = makeSession("recovered", cwd, [bashTurn(0, "git commit -m original", commitOutput(oldSha, "feat: original change"))]);
    const quiet = makeSession("quiet", cwd, [bashTurn(0, `git commit --quiet -m "${branchSubject}"`, "")], "claude-code", 2000);

    for (const order of [
      [repo(recovered), repo(quiet)],
      [repo(quiet), repo(recovered)],
    ]) {
      const sel = await selectContributors(order, [newSha], depsFor(cwd, [recovered, quiet], [branchSubject]));
      expect(sel.contributors.map((c) => [c.summary.id, c.basis])).toEqual([["recovered", "anchor"]]);
      expect(sel.excludedCount).toBe(1);
    }
  });

  it("does not fuzzily match a squashed branch commit to any constituent orphan", async () => {
    const cwd = await tempRepo();
    const main = currentBranch(cwd);
    git(cwd, ["checkout", "--quiet", "-b", "pre-squash"]);
    const first = await commitFile(cwd, "a.txt", "a\n", "feat: a");
    await commitFile(cwd, "b.txt", "b\n", "feat: b");
    await commitFile(cwd, "c.txt", "c\n", "feat: c");
    git(cwd, ["checkout", "--quiet", main]);
    await writeFile(join(cwd, "a.txt"), "a\n");
    await writeFile(join(cwd, "b.txt"), "b\n");
    await writeFile(join(cwd, "c.txt"), "c\n");
    git(cwd, ["add", "a.txt", "b.txt", "c.txt"]);
    git(cwd, ["commit", "--quiet", "-m", "feat: squash all"]);
    const squashSha = head(cwd);
    const s = makeSession("squashed", cwd, [bashTurn(0, "git commit -m a", commitOutput(first, "feat: a"))]);

    const sel = await selectContributors([repo(s)], [squashSha], depsFor(cwd, [s]));

    expect(sel.contributors).toHaveLength(0);
    expect(summarizeConfidence(sel.events).unanchoredGitWrite).toBe(1);
  });
});

describe("SPEC-0072 R2/R4/R5 - safety locks around recovery", () => {
  it("does not recover a message subject from a changed -F file", async () => {
    const cwd = await tempRepo();
    const subject = "feat: file supplied subject";
    await writeFile(join(cwd, "commit.txt"), `${subject}\n\nbody\n`);
    await writeFile(join(cwd, "file.txt"), "content\n");
    git(cwd, ["add", "file.txt"]);
    git(cwd, ["commit", "--quiet", "-F", "commit.txt"]);
    const branchSha = head(cwd);
    await writeFile(join(cwd, "commit.txt"), "feat: edited after commit\n");
    const s = makeSession("file-message", cwd, [bashTurn(0, "git commit -F commit.txt", "")]);

    const sel = await selectContributors([repo(s)], [branchSha], depsFor(cwd, [s], [subject]));

    expect(sel.contributors).toHaveLength(0);
    expect(summarizeConfidence(sel.events).unanchoredGitWrite).toBe(1);
  });

  it.each(["-c", "-C"])("does not recover a message subject from git commit %s", async (flag) => {
    const cwd = await tempRepo();
    const subject = "feat: reused message subject";
    const branchSha = await commitFile(cwd, "reuse.txt", "reuse\n", subject);
    const s = makeSession("reuse-message", cwd, [bashTurn(0, `git commit ${flag} ${branchSha}`, "")]);

    const sel = await selectContributors([repo(s)], [branchSha], depsFor(cwd, [s], [subject]));

    expect(sel.contributors).toHaveLength(0);
    expect(summarizeConfidence(sel.events).unanchoredGitWrite).toBe(1);
  });

  it("keeps the Codex helper rule scoped to sessions with writeCount === 0", async () => {
    const cwd = await tempRepo();
    const branchSha = await commitFile(cwd, "branch.txt", "branch\n", "feat: branch");
    const s = makeSession("codex-writer", cwd, [bashTurn(0, "git commit -m x", "nothing to commit, working tree clean")], "codex");

    const sel = await selectContributors([repo(s)], [branchSha], depsFor(cwd, [s]));

    expect(sel.contributors).toHaveLength(0);
    expect(sel.excludedCount).toBe(1);
    expect(summarizeConfidence(sel.events).unanchoredGitWrite).toBe(1);
  });

  it("still credits a direct SHA line from partially captured tee output", async () => {
    const cwd = await tempRepo();
    const branchSha = await commitFile(cwd, "tee.txt", "tee\n", "feat: tee");
    const s = makeSession("tee", cwd, [bashTurn(0, "git commit -m tee | tee log", commitOutput(branchSha, "feat: tee"))]);

    const sel = await selectContributors([repo(s)], [branchSha], depsFor(cwd, [s]));

    expect(sel.contributors.map((c) => [c.summary.id, c.basis])).toEqual([["tee", "anchor"]]);
    expect(sel.excludedCount).toBe(0);
  });

  it("labels a fully swallowed git-write output as unanchored when no message fallback applies", async () => {
    const cwd = await tempRepo();
    const branchSha = await commitFile(cwd, "swallowed.txt", "swallowed\n", "feat: swallowed output");
    const s = makeSession("swallowed", cwd, [bashTurn(0, "git commit -F commit.txt > log 2>&1 &", "")]);

    const sel = await selectContributors([repo(s)], [branchSha], depsFor(cwd, [s]));

    expect(sel.contributors).toHaveLength(0);
    expect(summarizeConfidence(sel.events).unanchoredGitWrite).toBe(1);
  });

  it("credits an amended committer and a zero-write Codex helper separately", async () => {
    const { cwd, oldSha, newSha } = await amendRepo(false);
    const builder = makeSession(
      "builder",
      cwd,
      [
        bashTurn(0, "git commit -m original", commitOutput(oldSha, "feat: original change")),
        bashTurn(1, "codex exec 'help with tests'", "done"),
      ],
      "claude-code",
      1000,
    );
    const helper = makeSession("helper", cwd, [bashTurn(0, "ls test", "anchorRecovery.test.ts")], "codex", 2000);

    const sel = await selectContributors([repo(builder), repo(helper)], [newSha], depsFor(cwd, [builder, helper]));

    expect(sel.contributors.map((c) => [c.summary.id, c.basis])).toEqual([
      ["builder", "anchor"],
      ["helper", "helper"],
    ]);
    expect(new Set(sel.contributors.map((c) => c.summary.filePath)).size).toBe(2);
    expect(sel.excludedCount).toBe(0);
  });
});
