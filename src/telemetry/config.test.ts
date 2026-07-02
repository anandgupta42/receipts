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

describe("SC connection-string honesty: empty/unset/malformed all collapse to the same disabled shape", () => {
  it("an unset connection string (default empty placeholder) disables telemetry — zero calls, not a fabricated key", () => {
    const config = resolveTelemetryConfig({});
    expect(config).toEqual({ enabled: false, instrumentationKey: undefined, ingestionEndpoint: undefined });
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
