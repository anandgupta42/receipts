import { describe, expect, it } from "vitest";
import {
  bucketDuration,
  bucketCount,
  bucketInstallAge,
  bucketOrdinal,
  classifyError,
  getCliVersion,
  isCiEnv,
  isInPackage,
  toAgentTypeTelemetry,
  toCommandTelemetry,
  toOsTelemetry,
} from "./helpers.js";

describe("toOsTelemetry", () => {
  it.each([
    ["darwin", "darwin"],
    ["linux", "linux"],
    ["win32", "win32"],
  ] as const)("maps %s to itself", (platform, expected) => {
    expect(toOsTelemetry(platform)).toBe(expected);
  });

  it("maps any other platform to 'other' — never the raw platform string", () => {
    expect(toOsTelemetry("freebsd" as NodeJS.Platform)).toBe("other");
    expect(toOsTelemetry("aix" as NodeJS.Platform)).toBe("other");
  });
});

describe("toAgentTypeTelemetry", () => {
  it("passes through a known AgentSource unchanged", () => {
    expect(toAgentTypeTelemetry("claude-code")).toBe("claude-code");
    expect(toAgentTypeTelemetry("codex")).toBe("codex");
    expect(toAgentTypeTelemetry("cursor")).toBe("cursor");
    expect(toAgentTypeTelemetry("opencode")).toBe("opencode");
  });

  it("defaults to 'unknown' when no agent source is available", () => {
    expect(toAgentTypeTelemetry(undefined)).toBe("unknown");
  });
});

describe("bucketDuration: R2 coarse buckets, never the raw millisecond count", () => {
  it.each([
    [0, "<100ms"],
    [99, "<100ms"],
    [100, "100-500ms"],
    [499, "100-500ms"],
    [500, "500ms-2s"],
    [1999, "500ms-2s"],
    [2000, "2-10s"],
    [9999, "2-10s"],
    [10_000, ">10s"],
    [999_999, ">10s"],
  ] as const)("buckets %ims as %s", (ms, expected) => {
    expect(bucketDuration(ms)).toBe(expected);
  });
});

describe("toCommandTelemetry: R2 closed 19-command taxonomy", () => {
  it.each([
    ["receipt", "receipt"],
    ["RECEIPT", "receipt"],
    ["  receipt  ", "receipt"],
    ["compare", "compare"],
    ["COMPARE", "compare"],
    ["stats", "stats"],
    ["version", "version"],
  ] as const)("maps %j to %s", (command, expected) => {
    expect(toCommandTelemetry(command)).toBe(expected);
  });

  it("drops any unrecognized command (or raw argv-like text) — never the raw command line", () => {
    expect(toCommandTelemetry("")).toBeUndefined();
    expect(toCommandTelemetry("--verbose --unknown-flag foo.json")).toBeUndefined();
    expect(toCommandTelemetry("some-future-subcommand")).toBeUndefined();
  });
});

describe("SPEC-0043 buckets", () => {
  it.each([
    [0, "0"],
    [1, "1"],
    [2, "2-3"],
    [3, "2-3"],
    [4, "4-10"],
    [10, "4-10"],
    [11, "11-50"],
    [50, "11-50"],
    [51, ">50"],
  ] as const)("bucketCount(%i) -> %s", (input, expected) => {
    expect(bucketCount(input)).toBe(expected);
  });

  it.each([
    [undefined, "unavailable"],
    [1, "1"],
    [3, "2-3"],
    [10, "4-10"],
    [51, ">50"],
  ] as const)("bucketOrdinal(%s) -> %s", (input, expected) => {
    expect(bucketOrdinal(input)).toBe(expected);
  });

  it.each([
    ["2026-07-04", Date.UTC(2026, 6, 4), "first_day"],
    ["2026-07-01", Date.UTC(2026, 6, 4), "2-7d"],
    ["2026-06-14", Date.UTC(2026, 6, 4), "8-30d"],
    ["2026-03-26", Date.UTC(2026, 6, 4), ">90d"],
    [undefined, Date.UTC(2026, 6, 4), "unavailable"],
  ] as const)("bucketInstallAge(%s) -> %s", (firstRunAt, now, expected) => {
    expect(bucketInstallAge(firstRunAt, now)).toBe(expected);
  });

  it("detects CI from CI/GITHUB_ACTIONS when set and not false", () => {
    expect(isCiEnv({ CI: "true" })).toBe(true);
    expect(isCiEnv({ GITHUB_ACTIONS: "1" })).toBe(true);
    expect(isCiEnv({ CI: "false", GITHUB_ACTIONS: "" })).toBe(false);
    expect(isCiEnv({})).toBe(false);
  });
});

describe("classifyError: R2 closed error taxonomy, never error.message", () => {
  it("classifies well-known Node IO error codes", () => {
    expect(classifyError(Object.assign(new Error("x"), { code: "ENOENT" }))).toBe("io_error");
    expect(classifyError(Object.assign(new Error("x"), { code: "EACCES" }))).toBe("io_error");
  });

  it("classifies well-known Node network error codes", () => {
    expect(classifyError(Object.assign(new Error("x"), { code: "ECONNREFUSED" }))).toBe("network_error");
    expect(classifyError(Object.assign(new Error("x"), { code: "ETIMEDOUT" }))).toBe("network_error");
  });

  it("classifies a ZodError-shaped constructor as validation_error", () => {
    class ZodError extends Error {}
    expect(classifyError(new ZodError("some message with a /path/to/file leaked in it"))).toBe("validation_error");
  });

  it("classifies a SyntaxError as parse_error", () => {
    expect(classifyError(new SyntaxError("Unexpected token in /Users/anand/secret.json"))).toBe("parse_error");
  });

  it("defaults to unknown_error for anything else, including plain strings and non-errors", () => {
    expect(classifyError(new Error("some very specific message with /a/path and $12.34 in it"))).toBe("unknown_error");
    expect(classifyError("a raw string, not even an Error")).toBe("unknown_error");
    expect(classifyError(null)).toBe("unknown_error");
    expect(classifyError(undefined)).toBe("unknown_error");
  });

  it("never returns the error message itself, even when the message contains a leakable value", () => {
    const err = new Error("failed to read /Users/anand/.ssh/id_rsa: $500 charged");
    const result = classifyError(err);
    expect(result).not.toContain("/Users");
    expect(result).not.toContain("$500");
    expect(["io_error", "network_error", "validation_error", "parse_error", "unknown_error"]).toContain(result);
  });
});

describe("isInPackage: returns a boolean only, never the stack frame text", () => {
  it("returns false for a non-Error value", () => {
    expect(isInPackage("not an error")).toBe(false);
    expect(isInPackage(undefined)).toBe(false);
  });

  it("returns false for an Error with no stack", () => {
    const err = new Error("x");
    err.stack = undefined;
    expect(isInPackage(err)).toBe(false);
  });

  it("returns a boolean (not a string) for a normal Error thrown from this test file", () => {
    const result = isInPackage(new Error("thrown from a test file, outside the package's own source"));
    expect(typeof result).toBe("boolean");
  });
});

describe("getCliVersion: reads package.json's version, never throws", () => {
  it("returns a non-empty semver-ish string", () => {
    const version = getCliVersion();
    expect(typeof version).toBe("string");
    expect(version.length).toBeGreaterThan(0);
    expect(version).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("returns a stable, cached value across repeated calls", () => {
    expect(getCliVersion()).toBe(getCliVersion());
  });
});
