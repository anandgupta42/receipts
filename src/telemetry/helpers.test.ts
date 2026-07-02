import { describe, expect, it } from "vitest";
import {
  bucketDuration,
  classifyError,
  getCliVersion,
  isInPackage,
  toAgentTypeTelemetry,
  toCommandClass,
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

describe("toCommandClass: R2 closed 3-value taxonomy", () => {
  it.each([
    ["receipt", "receipt"],
    ["", "receipt"],
    ["RECEIPT", "receipt"],
    ["  receipt  ", "receipt"],
    ["compare", "compare"],
    ["COMPARE", "compare"],
  ] as const)("maps %j to %s", (command, expected) => {
    expect(toCommandClass(command)).toBe(expected);
  });

  it("maps any unrecognized command (or raw argv-like text) to 'other' — never the raw command line", () => {
    expect(toCommandClass("--verbose --unknown-flag foo.json")).toBe("other");
    expect(toCommandClass("some-future-subcommand")).toBe("other");
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
