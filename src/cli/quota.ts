// R2 `--quota`: renders Claude Code's own statusline `rate_limits` fields
// verbatim — current-window usage exactly as Claude Code's local data states
// it, never a per-session share, never arithmetic on the percentage (SPEC-0014
// I2/R2). The R1 spike (docs/spikes/spec-0014-quota.md) found no on-disk
// state-file surface, so quota data is only ever available via the statusline
// stdin payload; anything else (no pipe, empty pipe, malformed JSON, missing
// or out-of-range fields) is the R4 unavailable case — print nothing, exit 0.

const WINDOW_LABELS: Record<string, string> = {
  five_hour: "5h",
  seven_day: "7d",
};

export interface QuotaTelemetryInfo {
  inputMode: "stdin_payload" | "none";
  payloadValid: boolean;
  result: "success" | "no_data";
}

function isUsablePercentage(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100;
}

/**
 * Pure rendering seam — SPEC-0014's "documented test seam" for stdin mode.
 * Given an already-parsed statusline JSON payload (or any unknown value),
 * returns the quota lines to print. Tests exercise this directly with
 * fixture payloads; no stdin plumbing required. Renders one line per
 * present, in-range window — a missing or malformed window is silently
 * skipped (R4), never guessed at.
 */
export function renderQuotaLines(payload: unknown): string[] {
  if (typeof payload !== "object" || payload === null) {
    return [];
  }
  const rateLimits = (payload as Record<string, unknown>).rate_limits;
  if (typeof rateLimits !== "object" || rateLimits === null) {
    return [];
  }
  const lines: string[] = [];
  for (const [key, label] of Object.entries(WINDOW_LABELS)) {
    const window = (rateLimits as Record<string, unknown>)[key];
    if (typeof window !== "object" || window === null) {
      continue;
    }
    const pct = (window as Record<string, unknown>).used_percentage;
    if (isUsablePercentage(pct)) {
      lines.push(`your ${label} window is at ${pct}% (official, from Claude Code's local data)`);
    }
  }
  return lines;
}

async function readAll(stream: NodeJS.ReadStream): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function readStdinPayloadInfo(stdin: NodeJS.ReadStream): Promise<{ payload: unknown; inputMode: "stdin_payload" | "none"; payloadValid: boolean }> {
  if (stdin.isTTY) {
    return { payload: undefined, inputMode: "none", payloadValid: false };
  }
  const raw = await readAll(stdin);
  if (raw.trim() === "") {
    return { payload: undefined, inputMode: "none", payloadValid: false };
  }
  try {
    return { payload: JSON.parse(raw), inputMode: "stdin_payload", payloadValid: true };
  } catch {
    return { payload: undefined, inputMode: "stdin_payload", payloadValid: false };
  }
}

/**
 * I/O wrapper: a single point-in-time read of one JSON payload from stdin
 * (R2 — no polling). Never reads when stdin is a TTY (interactive, no piped
 * payload — the standalone-mode R4 case, since R1 found no state file to
 * fall back to). Malformed JSON or an empty pipe resolves to `undefined`
 * rather than throwing.
 */
export async function readStdinPayload(stdin: NodeJS.ReadStream = process.stdin): Promise<unknown> {
  return (await readStdinPayloadInfo(stdin)).payload;
}

/**
 * `--quota` entrypoint. R3: zero network calls of its own — only parses what
 * was piped in. R4: no surface / malformed / stale → prints nothing, always
 * exits 0 (an absent quota is never an error).
 */
export async function runQuota(
  stdin: NodeJS.ReadStream = process.stdin,
  write: (s: string) => void = (s) => {
    process.stdout.write(s);
  },
  record?: (info: QuotaTelemetryInfo) => void | Promise<void>,
): Promise<number> {
  const info = await readStdinPayloadInfo(stdin);
  const payload = info.payload;
  const lines = renderQuotaLines(payload);
  if (lines.length > 0) {
    write(`${lines.join("\n")}\n`);
  }
  await record?.({ inputMode: info.inputMode, payloadValid: info.payloadValid && lines.length > 0, result: lines.length > 0 ? "success" : "no_data" });
  return 0;
}
