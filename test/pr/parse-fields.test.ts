// SPEC-0019 R1a/R1c — the parse-model extension: cwd/gitBranch captured for
// claude-code and codex (absent-in-raw → absent-in-model); child linkage derived
// for a subagent transcript.
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadById } from "../../src/parse/load.js";

const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "pr");
const CC = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "claude-code");
const CODEX = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "codex");

describe("R1a cwd/gitBranch capture", () => {
  it("captures first-seen cwd + gitBranch from a claude transcript", async () => {
    const s = (await loadById("claude-code", path.join(CC, "loop-bash-5x.jsonl")))!;
    expect(s.cwd).toBe("/home/dev/app");
    expect(s.gitBranch).toBe("fix/login-flake");
  });

  it("captures cwd from a codex transcript (no gitBranch in that format)", async () => {
    const s = (await loadById("codex", path.join(CODEX, "clean-session.jsonl")))!;
    expect(s.cwd).toBe("/home/dev/app2");
    expect(s.gitBranch).toBeUndefined();
  });

  it("absent in the raw → absent in the model", async () => {
    const s = (await loadById("claude-code", path.join(FIX, "claude-no-cwd.jsonl")))!;
    expect(s.cwd).toBeUndefined();
    expect(s.gitBranch).toBeUndefined();
  });
});

describe("R1c child linkage", () => {
  it("marks a subagent transcript and links it to its parent", async () => {
    const childPath = path.join(FIX, "parent-with-subagents", "subagents", "agent-child1.jsonl");
    const s = (await loadById("claude-code", childPath))!;
    expect(s.isSidechain).toBe(true);
    expect(s.agentId).toBe("child1");
    expect(s.parentSessionId).toBe("parent-with-subagents");
    expect(s.parentFilePath).toBe(path.join(FIX, "parent-with-subagents.jsonl"));
  });

  it("a normal session is not a child", async () => {
    const s = (await loadById("claude-code", path.join(FIX, "parent-with-subagents.jsonl")))!;
    expect(s.isSidechain).toBeUndefined();
    expect(s.parentFilePath).toBeUndefined();
  });
});
