import { describe, expect, it } from "vitest";
import {
  EVENT_NAMES,
  cliErrorPropertiesSchema,
  cliRunPropertiesSchema,
  parseFailurePropertiesSchema,
  validateEvent,
  type CliErrorEvent,
  type CliRunEvent,
  type ParseFailureEvent,
} from "./schemas.js";

describe("R2: exactly three event names", () => {
  it("is exhaustive over cli_run, cli_error, parse_failure — no more, no less", () => {
    expect([...EVENT_NAMES].sort()).toEqual(["cli_error", "cli_run", "parse_failure"]);
  });
});

describe("R2: valid events pass their schema", () => {
  it("accepts a well-formed cli_run event", () => {
    const event: CliRunEvent = {
      name: "cli_run",
      properties: {
        cliVersion: "0.1.0",
        os: "darwin",
        nodeMajor: 22,
        commandClass: "receipt",
        agentType: "opencode",
        durationBucket: "100-500ms",
        ok: true,
      },
    };
    expect(validateEvent(event)).toBe(true);
  });

  it("accepts a well-formed cli_error event", () => {
    const event: CliErrorEvent = {
      name: "cli_error",
      properties: {
        errorClass: "io_error",
        command: "receipt",
        agentType: "codex",
        inPackage: false,
      },
    };
    expect(validateEvent(event)).toBe(true);
  });

  it("accepts a well-formed parse_failure event", () => {
    const event: ParseFailureEvent = {
      name: "parse_failure",
      properties: {
        agentType: "cursor",
        adapterVersion: "1",
        signatureHash: "a".repeat(64),
      },
    };
    expect(validateEvent(event)).toBe(true);
  });

  it("R2: commandClass/command enum covers every CLI command class", () => {
    for (const value of ["receipt", "compare", "other"] as const) {
      expect(
        cliRunPropertiesSchema.safeParse({
          cliVersion: "0.1.0",
          os: "linux",
          nodeMajor: 20,
          commandClass: value,
          agentType: "unknown",
          durationBucket: "<100ms",
          ok: true,
        }).success,
      ).toBe(true);
      expect(
        cliErrorPropertiesSchema.safeParse({
          errorClass: "unknown_error",
          command: value,
          agentType: "unknown",
          inPackage: true,
        }).success,
      ).toBe(true);
    }
  });
});

describe("R3: leakage fixtures — banned content is structurally rejected", () => {
  const validCliRun = {
    cliVersion: "0.1.0",
    os: "darwin" as const,
    nodeMajor: 22,
    commandClass: "receipt" as const,
    agentType: "claude-code" as const,
    durationBucket: "100-500ms" as const,
    ok: true,
  };

  it.each([
    ["a raw file path", { path: "/Users/anand/secret-project/main.py" }],
    ["a prompt snippet", { prompt: "write me a function that deletes prod" }],
    ["a repo name", { repo: "altimateai/altimate-backend" }],
    ["a hostname", { hostname: "anand-macbook.local" }],
    ["a username", { username: "anand" }],
    ["a session id", { sessionId: "sess_9f8a7b6c" }],
    ["a dollar amount", { costUsd: 12.34 }],
    ["a raw model string", { model: "claude-fable-5-20260615" }],
    ["transcript content", { transcript: "user: help me debug this\nassistant: sure" }],
  ])("rejects an event with %s smuggled in via an extra property", (_label, extra) => {
    const polluted = { ...validCliRun, ...extra };
    expect(cliRunPropertiesSchema.safeParse(polluted).success).toBe(false);
  });

  it("rejects a cliVersion field containing a path instead of a semver string", () => {
    expect(cliRunPropertiesSchema.safeParse({ ...validCliRun, cliVersion: "/Users/anand/aireceipts" }).success).toBe(false);
  });

  it("rejects an os field containing free text instead of the closed enum", () => {
    expect(cliRunPropertiesSchema.safeParse({ ...validCliRun, os: "MacBook-Pro.local" }).success).toBe(false);
  });

  it("rejects a signatureHash that is raw transcript text instead of a sha256 hex digest", () => {
    expect(
      parseFailurePropertiesSchema.safeParse({
        agentType: "claude-code",
        adapterVersion: "1",
        signatureHash: "assistant: I ran `rm -rf /` by mistake",
      }).success,
    ).toBe(false);
  });

  it("rejects an adapterVersion field containing a long free-text string", () => {
    expect(
      parseFailurePropertiesSchema.safeParse({
        agentType: "claude-code",
        adapterVersion: "this is not a version, this is a whole sentence of leaked content",
        signatureHash: "b".repeat(64),
      }).success,
    ).toBe(false);
  });

  it("validateEvent returns false (never throws) for an unrecognized event name", () => {
    expect(validateEvent({ name: "unknown_event" as never, properties: {} as never })).toBe(false);
  });
});
