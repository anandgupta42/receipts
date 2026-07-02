import { resolveTelemetryConfig } from "./config.js";
import { validateEvent, type TelemetryEvent } from "./schemas.js";

/**
 * In-process queue + bounded sender (SPEC-0002 R1/R6). `recordEvent`
 * validates and enqueues; `flushTelemetry` drains the queue in one batch
 * request, bounded to `timeoutMs` via `Promise.race` against global
 * `fetch` (Node >=20, no new HTTP-client dependency needed). Every failure
 * mode — disabled config, invalid event, network error, timeout — is
 * swallowed here: telemetry must never throw, block, or change the CLI's
 * exit code (R1).
 */

let queue: TelemetryEvent[] = [];

/** Validates + enqueues one event. Silently drops anything that fails schema validation (R3) — an invalid event is never sent partially or "best-effort." */
export function recordEvent(event: TelemetryEvent): void {
  if (validateEvent(event)) {
    queue.push(event);
  }
}

interface AppInsightsEnvelope {
  name: string;
  time: string;
  iKey: string;
  data: {
    baseType: "EventData";
    baseData: { ver: 2; name: string; properties: Record<string, unknown> };
  };
}

function toAppInsightsEnvelope(event: TelemetryEvent, instrumentationKey: string): AppInsightsEnvelope {
  return {
    name: `Microsoft.ApplicationInsights.${instrumentationKey}.Event`,
    time: new Date().toISOString(),
    iKey: instrumentationKey,
    data: {
      baseType: "EventData",
      baseData: { ver: 2, name: event.name, properties: event.properties },
    },
  };
}

async function sendBatch(events: TelemetryEvent[], instrumentationKey: string, ingestionEndpoint: string): Promise<void> {
  const body = JSON.stringify(events.map((e) => toAppInsightsEnvelope(e, instrumentationKey)));
  await fetch(`${ingestionEndpoint.replace(/\/+$/, "")}/v2/track`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });
}

function timeout(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface FlushOptions {
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
}

/**
 * Drains the queue and attempts to send it as one batch, bounded to
 * `timeoutMs` (default 300, per R1). Always resolves — never rejects,
 * never awaits past the budget — regardless of whether the send actually
 * completed; a slow or hung network call is abandoned in place, not
 * awaited to completion in the background (nothing keeps the process
 * alive past this call).
 */
export async function flushTelemetry(options: FlushOptions = {}): Promise<void> {
  const { timeoutMs = 300, env = process.env } = options;
  const config = resolveTelemetryConfig(env);
  const batch = queue;
  queue = [];

  if (!config.enabled || batch.length === 0 || !config.instrumentationKey || !config.ingestionEndpoint) {
    return;
  }

  const send = sendBatch(batch, config.instrumentationKey, config.ingestionEndpoint).catch(() => undefined);
  await Promise.race([send, timeout(timeoutMs)]);
}

/** Test-only: clears the in-process queue between tests. Not exported from `index.ts`. */
export function __resetQueueForTests(): void {
  queue = [];
}

/** Read-only snapshot of the queued-but-unsent events, without draining it. Backs `--telemetry-show` (R5): inspect what a run *would* send without actually sending it. */
export function peekQueuedEvents(): readonly TelemetryEvent[] {
  return queue;
}
