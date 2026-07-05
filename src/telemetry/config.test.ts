import { describe, expect, it } from "vitest";
import { resolveTelemetryConfig } from "./config.js";

const VALID_CONN = "InstrumentationKey=abc-123;IngestionEndpoint=https://example.in.applicationinsights.azure.com/";

describe("R4: kill switches disable telemetry", () => {
  it.each(["off", "0", "false", "OFF", "False"])("AIRECEIPTS_TELEMETRY=%s disables telemetry", (value) => {
    const config = resolveTelemetryConfig({ AIRECEIPTS_TELEMETRY: value, AIRECEIPTS_TELEMETRY_CONNECTION: VALID_CONN });
    expect(config).toEqual({ enabled: false, instrumentationKey: undefined, ingestionEndpoint: undefined });
  });

  it("DO_NOT_TRACK=1 disables telemetry even with a valid connection string", () => {
    const config = resolveTelemetryConfig({ DO_NOT_TRACK: "1", AIRECEIPTS_TELEMETRY_CONNECTION: VALID_CONN });
    expect(config.enabled).toBe(false);
  });

  it("DO_NOT_TRACK with any other value does not disable telemetry", () => {
    const config = resolveTelemetryConfig({ DO_NOT_TRACK: "0", AIRECEIPTS_TELEMETRY_CONNECTION: VALID_CONN });
    expect(config.enabled).toBe(true);
  });
});

describe("CI default-off (2026-07-05 amendment): explicit on beats CI, kill switches beat everything", () => {
  it.each([
    ["CI unset, AIRECEIPTS_TELEMETRY unset", {}, true],
    ["CI=true, AIRECEIPTS_TELEMETRY unset", { CI: "true" }, false],
    ["CI=true, AIRECEIPTS_TELEMETRY=on", { CI: "true", AIRECEIPTS_TELEMETRY: "on" }, true],
    ["CI=true, AIRECEIPTS_TELEMETRY=off", { CI: "true", AIRECEIPTS_TELEMETRY: "off" }, false],
    ["CI=true, DO_NOT_TRACK=1, AIRECEIPTS_TELEMETRY=on", { CI: "true", DO_NOT_TRACK: "1", AIRECEIPTS_TELEMETRY: "on" }, false],
    ["GITHUB_ACTIONS=1, AIRECEIPTS_TELEMETRY unset", { GITHUB_ACTIONS: "1" }, false],
    ["CI=false, AIRECEIPTS_TELEMETRY unset (not CI)", { CI: "false" }, true],
  ] as const)("%s -> enabled=%s", (_label, env, expectedEnabled) => {
    const config = resolveTelemetryConfig({ ...env, AIRECEIPTS_TELEMETRY_CONNECTION: VALID_CONN });
    expect(config.enabled).toBe(expectedEnabled);
  });

  it("non-CI runs are unaffected by the amendment — off/on/unset behave exactly as before", () => {
    expect(resolveTelemetryConfig({ AIRECEIPTS_TELEMETRY_CONNECTION: VALID_CONN }).enabled).toBe(true);
    expect(resolveTelemetryConfig({ AIRECEIPTS_TELEMETRY: "off", AIRECEIPTS_TELEMETRY_CONNECTION: VALID_CONN }).enabled).toBe(false);
    expect(resolveTelemetryConfig({ AIRECEIPTS_TELEMETRY: "on", AIRECEIPTS_TELEMETRY_CONNECTION: VALID_CONN }).enabled).toBe(true);
  });
});

describe("SC connection-string honesty: empty/unset/malformed all collapse to the same disabled shape", () => {
  it("an unset connection string uses the shipped default key — enabled (docs/telemetry.md states the key openly)", () => {
    const config = resolveTelemetryConfig({});
    expect(config.enabled).toBe(true);
    expect(config.instrumentationKey).toBe("394da360-a50c-4700-bcf9-87b8d9d6e0ee");
    expect(config.ingestionEndpoint).toContain("eastus-8.in.applicationinsights.azure.com");
  });

  it("an explicitly empty connection string disables telemetry", () => {
    const config = resolveTelemetryConfig({ AIRECEIPTS_TELEMETRY_CONNECTION: "" });
    expect(config.enabled).toBe(false);
  });

  it("a malformed connection string (missing IngestionEndpoint) disables telemetry rather than sending to an incomplete endpoint", () => {
    const config = resolveTelemetryConfig({ AIRECEIPTS_TELEMETRY_CONNECTION: "InstrumentationKey=abc-123" });
    expect(config).toEqual({ enabled: false, instrumentationKey: undefined, ingestionEndpoint: undefined });
  });

  it("a malformed connection string (missing InstrumentationKey) disables telemetry", () => {
    const config = resolveTelemetryConfig({
      AIRECEIPTS_TELEMETRY_CONNECTION: "IngestionEndpoint=https://example.in.applicationinsights.azure.com/",
    });
    expect(config.enabled).toBe(false);
  });

  it("garbage (no key=value pairs at all) disables telemetry", () => {
    const config = resolveTelemetryConfig({ AIRECEIPTS_TELEMETRY_CONNECTION: "not-a-connection-string" });
    expect(config.enabled).toBe(false);
  });
});

describe("SC connection-string override: a valid custom connection string routes to itself", () => {
  it("parses InstrumentationKey and IngestionEndpoint out of a well-formed connection string", () => {
    const config = resolveTelemetryConfig({ AIRECEIPTS_TELEMETRY_CONNECTION: VALID_CONN });
    expect(config).toEqual({
      enabled: true,
      instrumentationKey: "abc-123",
      ingestionEndpoint: "https://example.in.applicationinsights.azure.com/",
    });
  });

  it("tolerates extra whitespace around fields", () => {
    const config = resolveTelemetryConfig({
      AIRECEIPTS_TELEMETRY_CONNECTION: " InstrumentationKey = abc-123 ; IngestionEndpoint = https://example.com/ ",
    });
    expect(config.instrumentationKey).toBe("abc-123");
    expect(config.ingestionEndpoint).toBe("https://example.com/");
  });
});
