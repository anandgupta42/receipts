import { describe, expect, it } from "vitest";
import { BENCHMARK_EVENT_NAMES, benchmarkRunPropertiesSchema, validateBenchmarkEvent, type BenchmarkRunEvent } from "./schemas.js";

describe("R2: exactly one event name", () => {
  it("is exhaustive over benchmark_run — no more, no less", () => {
    expect([...BENCHMARK_EVENT_NAMES]).toEqual(["benchmark_run"]);
  });
});

describe("R2: a valid event passes its schema", () => {
  it("accepts a well-formed benchmark_run event", () => {
    const event: BenchmarkRunEvent = {
      name: "benchmark_run",
      properties: {
        agentType: "claude-code",
        modelFamily: "anthropic",
        costPerTurnBucket: "$0.01-$0.05",
        pricingCoverage: "full",
        hasStuckLoopWaste: false,
        hasTrivialSpanWaste: true,
      },
    };
    expect(validateBenchmarkEvent(event)).toBe(true);
  });

  it("validateBenchmarkEvent returns false (never throws) for an unrecognized event name", () => {
    expect(validateBenchmarkEvent({ name: "unknown_event" as never, properties: {} as never })).toBe(false);
  });
});

describe("R2/R6: leakage fixtures — banned content is structurally rejected", () => {
  const validRun = {
    agentType: "claude-code" as const,
    modelFamily: "anthropic" as const,
    costPerTurnBucket: "$0.01-$0.05" as const,
    pricingCoverage: "full" as const,
    hasStuckLoopWaste: false,
    hasTrivialSpanWaste: false,
  };

  it.each([
    ["a raw file path", { path: "/Users/anand/secret-project/main.py" }],
    ["a prompt snippet", { prompt: "write me a function that deletes prod" }],
    ["a repo name", { repo: "altimateai/altimate-backend" }],
    ["a hostname", { hostname: "anand-macbook.local" }],
    ["a username", { username: "anand" }],
    ["a session id", { sessionId: "sess_9f8a7b6c" }],
    ["a raw dollar amount", { totalUsd: 12.34 }],
    ["a raw model string", { model: "claude-fable-5-20260615" }],
    ["transcript content", { transcript: "user: help me debug this\nassistant: sure" }],
    ["an install ID", { installId: "install_abc123" }],
    ["a repeated-caller token", { callerToken: "tok_persistent_9f8a" }],
  ])("rejects an event with %s smuggled in via an extra property", (_label, extra) => {
    const polluted = { ...validRun, ...extra };
    expect(benchmarkRunPropertiesSchema.safeParse(polluted).success).toBe(false);
  });

  it("rejects an agentType outside the closed enum", () => {
    expect(benchmarkRunPropertiesSchema.safeParse({ ...validRun, agentType: "windsurf" }).success).toBe(false);
  });

  it("rejects a modelFamily outside the closed enum (never a raw model ID)", () => {
    expect(benchmarkRunPropertiesSchema.safeParse({ ...validRun, modelFamily: "claude-fable-5" }).success).toBe(false);
  });

  it("rejects a costPerTurnBucket outside the closed enum (never a raw dollar figure)", () => {
    expect(benchmarkRunPropertiesSchema.safeParse({ ...validRun, costPerTurnBucket: "$12.34" }).success).toBe(false);
  });

  it("rejects pricing coverage outside the closed enum", () => {
    expect(benchmarkRunPropertiesSchema.safeParse({ ...validRun, pricingCoverage: "mostly" }).success).toBe(false);
  });

  it("rejects a non-boolean waste flag", () => {
    expect(benchmarkRunPropertiesSchema.safeParse({ ...validRun, hasStuckLoopWaste: "yes" }).success).toBe(false);
  });
});
