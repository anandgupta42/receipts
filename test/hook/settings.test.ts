// SPEC-0006 R1/R3/R5: the pure settings.json tree operations. No I/O — these
// assert the nested `hooks.SessionEnd[].hooks[]` merge/remove is structural
// (every unrelated key deep-equal before/after), idempotent, and that parse
// rejects invalid JSON so the caller can abort with no write.
import { describe, expect, it } from "vitest";
import {
  HOOK_COMMAND,
  diffLines,
  hasHookEntry,
  malformedHooksShape,
  parseSettings,
  serializeSettings,
  sessionEndEntry,
  withHookEntry,
  withoutHookEntry,
} from "../../src/hook/settings.js";

describe("parseSettings", () => {
  it("parses a normal object", () => {
    expect(parseSettings('{"a":1}')).toEqual({ a: 1 });
  });

  it("treats empty / whitespace as an empty settings object (fresh box)", () => {
    expect(parseSettings("")).toEqual({});
    expect(parseSettings("   \n ")).toEqual({});
  });

  it("throws on invalid JSON (so the caller aborts with no write, R3)", () => {
    expect(() => parseSettings("{ not json ")).toThrow();
  });

  it("throws on a non-object top-level value", () => {
    expect(() => parseSettings("[1,2,3]")).toThrow();
    expect(() => parseSettings("42")).toThrow();
  });
});

describe("withHookEntry (R3 merge)", () => {
  it("adds the nested SessionEnd entry to a fresh settings object", () => {
    const { next, changed } = withHookEntry({});
    expect(changed).toBe(true);
    expect(next).toEqual({ hooks: { SessionEnd: [sessionEndEntry()] } });
  });

  it("writes exactly the R3 command shape (command + native timeout)", () => {
    const entry = sessionEndEntry() as { matcher: string; hooks: { type: string; command: string; timeout: number }[] };
    expect(entry.matcher).toBe("*");
    expect(entry.hooks[0].type).toBe("command");
    expect(entry.hooks[0].command).toBe(HOOK_COMMAND);
    expect(entry.hooks[0].timeout).toBe(10);
  });

  it("preserves unrelated hooks and keys deep-equal (structural merge)", () => {
    const original = {
      env: { FOO: "bar" },
      hooks: {
        PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "guard.sh" }] }],
        SessionEnd: [{ matcher: "*", hooks: [{ type: "command", command: "someone-elses-hook" }] }],
      },
      model: "claude-fable-5",
    };
    const snapshot = structuredClone(original);
    const { next } = withHookEntry(original);
    // input not mutated
    expect(original).toEqual(snapshot);
    // every unrelated key preserved
    expect(next.env).toEqual({ FOO: "bar" });
    expect(next.model).toBe("claude-fable-5");
    expect((next.hooks as Record<string, unknown>).PreToolUse).toEqual(original.hooks.PreToolUse);
    // the pre-existing SessionEnd entry still there, ours appended after it
    const se = (next.hooks as Record<string, unknown>).SessionEnd as unknown[];
    expect(se).toHaveLength(2);
    expect(se[0]).toEqual(original.hooks.SessionEnd[0]);
    expect(se[1]).toEqual(sessionEndEntry());
  });

  it("is an idempotent no-op when already installed", () => {
    const once = withHookEntry({}).next;
    const { next, changed } = withHookEntry(once);
    expect(changed).toBe(false);
    expect(next).toBe(once);
    expect((next.hooks as { SessionEnd: unknown[] }).SessionEnd).toHaveLength(1);
  });
});

describe("withoutHookEntry (R5 uninstall)", () => {
  it("removes exactly our entry and drops emptied scaffolding", () => {
    const installed = withHookEntry({}).next;
    const { next, changed } = withoutHookEntry(installed);
    expect(changed).toBe(true);
    expect(next).toEqual({});
  });

  it("removes only our entry, leaving other SessionEnd hooks untouched", () => {
    const other = { matcher: "*", hooks: [{ type: "command", command: "someone-elses-hook" }] };
    const installed = withHookEntry({ hooks: { SessionEnd: [other] } }).next;
    const { next } = withoutHookEntry(installed);
    expect((next.hooks as { SessionEnd: unknown[] }).SessionEnd).toEqual([other]);
  });

  it("strips only our command from a shared entry, keeping sibling hooks (R5)", () => {
    // A hand-merged entry that carries our command alongside someone else's.
    const shared = {
      hooks: {
        SessionEnd: [
          {
            matcher: "*",
            hooks: [
              { type: "command", command: "someone-elses-hook" },
              { type: "command", command: HOOK_COMMAND, timeout: 10 },
            ],
          },
        ],
      },
    };
    const { next, changed } = withoutHookEntry(shared);
    expect(changed).toBe(true);
    const se = (next.hooks as { SessionEnd: { hooks: unknown[] }[] }).SessionEnd;
    expect(se).toHaveLength(1);
    expect(se[0].hooks).toEqual([{ type: "command", command: "someone-elses-hook" }]);
  });

  it("is a no-op when our entry is absent", () => {
    const settings = { hooks: { PreToolUse: [] } };
    const { next, changed } = withoutHookEntry(settings);
    expect(changed).toBe(false);
    expect(next).toBe(settings);
  });
});

describe("hasHookEntry", () => {
  it("detects our entry regardless of a sibling timeout/field ordering", () => {
    expect(hasHookEntry({})).toBe(false);
    expect(hasHookEntry({ hooks: { SessionEnd: [sessionEndEntry()] } })).toBe(true);
    // identity is the command string, not the whole object
    const noTimeout = { matcher: "*", hooks: [{ type: "command", command: HOOK_COMMAND }] };
    expect(hasHookEntry({ hooks: { SessionEnd: [noTimeout] } })).toBe(true);
  });
});

describe("malformedHooksShape (R3 clobber guard)", () => {
  it("passes a normal or absent hooks tree", () => {
    expect(malformedHooksShape({})).toBeNull();
    expect(malformedHooksShape({ hooks: {} })).toBeNull();
    expect(malformedHooksShape({ hooks: { SessionEnd: [] } })).toBeNull();
    expect(malformedHooksShape({ model: "x" })).toBeNull();
  });

  it("flags a non-object hooks (would otherwise be clobbered)", () => {
    expect(malformedHooksShape({ hooks: "oops" })).toContain("not a JSON object");
    expect(malformedHooksShape({ hooks: [1, 2] })).toContain("not a JSON object");
  });

  it("flags a non-array hooks.SessionEnd", () => {
    expect(malformedHooksShape({ hooks: { SessionEnd: { matcher: "*" } } })).toContain("not an array");
  });
});

describe("serializeSettings", () => {
  it("emits 2-space JSON with a trailing newline", () => {
    expect(serializeSettings({ a: 1 })).toBe('{\n  "a": 1\n}\n');
  });
});

describe("diffLines", () => {
  it("marks a contiguous insertion with + and shows context", () => {
    const before = serializeSettings({});
    const after = serializeSettings(withHookEntry({}).next);
    const diff = diffLines(before, after);
    expect(diff).toContain(`+`);
    expect(diff).toContain(HOOK_COMMAND);
  });

  it("marks removals with - on uninstall", () => {
    const installed = serializeSettings(withHookEntry({}).next);
    const removed = serializeSettings(withoutHookEntry(withHookEntry({}).next).next);
    const diff = diffLines(installed, removed);
    expect(diff).toContain("-");
  });
});
