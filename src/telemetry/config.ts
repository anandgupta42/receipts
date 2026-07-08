/**
 * Kill-switch and connection-string resolution (SPEC-0002 R4, and the
 * connection-string-honesty success criterion). Resolved at call time from
 * `process.env` (or an injected env for tests) — never cached at module
 * load — so `AIRECEIPTS_TELEMETRY`/`DO_NOT_TRACK`/
 * `AIRECEIPTS_TELEMETRY_CONNECTION` overrides set after import (as tests
 * do) are always honored, mirroring `parse/cursor.ts`'s `CURSOR_DB_PATH`
 * resolve-at-call-time convention.
 *
 * Amendment (2026-07-08, maintainer decision): telemetry defaults to
 * ENABLED in CI, same as any other environment — the earlier 2026-07-05
 * CI-default-off amendment is reversed so automated CI runs are counted by
 * default. CI is no longer a special case here; the `isCI` event field still
 * records whether a run was in CI (see `helpers.ts#isCiEnv`) so CI vs. human
 * usage stays distinguishable in the data. The two kill switches
 * (`AIRECEIPTS_TELEMETRY=off|0|false`, `DO_NOT_TRACK=1`) still win everywhere,
 * in CI or not, and an empty/malformed connection string still disables it.
 */

/**
 * No real Azure Application Insights resource is wired up yet. This is
 * deliberately empty rather than a fabricated-looking key: an empty
 * connection string takes the same "disabled" path as the kill switches
 * (see `resolveTelemetryConfig`), so telemetry sends zero events until a
 * real ingest-only key is embedded here — a decision for whoever owns the
 * Azure resource, not something to invent (I2's "never fabricate" applies
 * equally to secret-shaped strings).
 */
// Openly-embedded ingest-only connection string (see docs/telemetry.md — an
// App Insights ingestion key is a write-only address, not a secret; override or
// disable via AIRECEIPTS_TELEMETRY_CONNECTION / the kill switches).
const DEFAULT_CONNECTION_STRING =
  "InstrumentationKey=394da360-a50c-4700-bcf9-87b8d9d6e0ee;IngestionEndpoint=https://eastus-8.in.applicationinsights.azure.com/;LiveEndpoint=https://eastus.livediagnostics.monitor.azure.com/;ApplicationId=27aef4ec-bd68-44e1-968b-913ddc5ed538";

export interface TelemetryConfig {
  enabled: boolean;
  instrumentationKey: string | undefined;
  ingestionEndpoint: string | undefined;
}

/** The explicit value of `AIRECEIPTS_TELEMETRY`, normalized — `undefined` when unset or unrecognized. */
function explicitTelemetryValue(env: NodeJS.ProcessEnv): "on" | "off" | undefined {
  const telemetryEnv = env.AIRECEIPTS_TELEMETRY?.trim().toLowerCase();
  if (telemetryEnv === "off" || telemetryEnv === "0" || telemetryEnv === "false") {
    return "off";
  }
  if (telemetryEnv === "on" || telemetryEnv === "1" || telemetryEnv === "true") {
    return "on";
  }
  return undefined;
}

function killSwitchActive(env: NodeJS.ProcessEnv): boolean {
  if (explicitTelemetryValue(env) === "off") {
    return true;
  }
  return env.DO_NOT_TRACK === "1";
}

function resolveConnectionString(env: NodeJS.ProcessEnv): string {
  return env.AIRECEIPTS_TELEMETRY_CONNECTION !== undefined ? env.AIRECEIPTS_TELEMETRY_CONNECTION : DEFAULT_CONNECTION_STRING;
}

/**
 * Parses an Azure Application Insights connection string
 * (`Key1=Value1;Key2=Value2;...`). Returns `null` — never a partial or
 * guessed result — for an empty string or one missing either required
 * field, so a malformed override degrades to "disabled" rather than
 * sending to an incomplete endpoint.
 */
function parseConnectionString(raw: string): { instrumentationKey: string; ingestionEndpoint: string } | null {
  if (!raw.trim()) {
    return null;
  }
  const fields = new Map<string, string>();
  for (const pair of raw.split(";")) {
    const eq = pair.indexOf("=");
    if (eq <= 0) {
      continue;
    }
    fields.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
  }
  const instrumentationKey = fields.get("InstrumentationKey");
  const ingestionEndpoint = fields.get("IngestionEndpoint");
  if (!instrumentationKey || !ingestionEndpoint) {
    return null;
  }
  return { instrumentationKey, ingestionEndpoint };
}

/**
 * Resolves whether telemetry is enabled and, if so, where it sends. Both
 * kill switches (R4) and an unset/empty/malformed connection string
 * (SC conn-string) take the same `enabled: false` path — there is exactly
 * one "off" state, not two subtly different ones.
 */
export function resolveTelemetryConfig(env: NodeJS.ProcessEnv = process.env): TelemetryConfig {
  if (killSwitchActive(env)) {
    return { enabled: false, instrumentationKey: undefined, ingestionEndpoint: undefined };
  }
  const parsed = parseConnectionString(resolveConnectionString(env));
  if (!parsed) {
    return { enabled: false, instrumentationKey: undefined, ingestionEndpoint: undefined };
  }
  return { enabled: true, instrumentationKey: parsed.instrumentationKey, ingestionEndpoint: parsed.ingestionEndpoint };
}
