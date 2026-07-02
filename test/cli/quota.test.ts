import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readStdinPayload, renderQuotaLines, runQuota } from "../../src/cli/quota.js";

/**
 * Minimal fake stdin: a Readable-shaped EventEmitter with an `isTTY` flag and
 * an async iterator, matching the subset of `NodeJS.ReadStream` `quota.ts`
 * actually uses (`isTTY`, `for await...of`).
 */
function fakeStdin(chunks: string[], isTTY = false): NodeJS.ReadStream {
  const stream = new EventEmitter() as unknown as NodeJS.ReadStream;
  (stream as unknown as { isTTY: boolean }).isTTY = isTTY;
  (stream as unknown as { [Symbol.asyncIterator]: () => AsyncIterator<string> })[Symbol.asyncIterator] = async function* () {
    for (const chunk of chunks) {
      yield chunk;
    }
  };
  return stream;
}

const VALID_PAYLOAD = {
  rate_limits: {
    five_hour: { used_percentage: 23.5, resets_at: 1738425600 },
    seven_day: { used_percentage: 41.2, resets_at: 1738857600 },
  },
};

describe("R2: renderQuotaLines — current-window usage, verbatim", () => {
  it("renders one line per present, in-range window with the verbatim percentage", () => {
    const lines = renderQuotaLines(VALID_PAYLOAD);
    expect(lines).toEqual([
      "your 5h window is at 23.5% (official, from Claude Code's local data)",
      "your 7d window is at 41.2% (official, from Claude Code's local data)",
    ]);
  });

  it("renders only the window that is present when the other is absent", () => {
    const lines = renderQuotaLines({ rate_limits: { five_hour: { used_percentage: 10 } } });
    expect(lines).toEqual(["your 5h window is at 10% (official, from Claude Code's local data)"]);
  });

  it("never phrases output as a per-session share", () => {
    const lines = renderQuotaLines(VALID_PAYLOAD);
    for (const line of lines) {
      expect(line).not.toMatch(/session used/i);
    }
  });
});

describe("R3: no-network proof", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("runQuota never calls fetch, even with a valid rate_limits payload piped in", async () => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const stdin = fakeStdin([JSON.stringify(VALID_PAYLOAD)]);
    const code = await runQuota(stdin);

    expect(code).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("R4: unavailable case — nothing printed, exit 0", () => {
  it("readStdinPayload returns undefined for a TTY (interactive, no piped payload)", async () => {
    const stdin = fakeStdin([], true);
    await expect(readStdinPayload(stdin)).resolves.toBeUndefined();
  });

  it("readStdinPayload returns undefined for an empty pipe", async () => {
    const stdin = fakeStdin([""]);
    await expect(readStdinPayload(stdin)).resolves.toBeUndefined();
  });

  it("readStdinPayload returns undefined for malformed JSON", async () => {
    const stdin = fakeStdin(["{not json"]);
    await expect(readStdinPayload(stdin)).resolves.toBeUndefined();
  });

  it("renderQuotaLines returns [] for a non-object payload", () => {
    expect(renderQuotaLines(undefined)).toEqual([]);
    expect(renderQuotaLines(null)).toEqual([]);
    expect(renderQuotaLines("a string")).toEqual([]);
  });

  it("renderQuotaLines returns [] when rate_limits is missing", () => {
    expect(renderQuotaLines({ cwd: "/tmp" })).toEqual([]);
  });

  it("renderQuotaLines skips a window whose used_percentage is out of range", () => {
    expect(renderQuotaLines({ rate_limits: { five_hour: { used_percentage: 150 } } })).toEqual([]);
    expect(renderQuotaLines({ rate_limits: { five_hour: { used_percentage: -1 } } })).toEqual([]);
  });

  it("renderQuotaLines skips a window whose used_percentage is non-numeric or missing", () => {
    expect(renderQuotaLines({ rate_limits: { five_hour: { used_percentage: "23.5" } } })).toEqual([]);
    expect(renderQuotaLines({ rate_limits: { five_hour: {} } })).toEqual([]);
  });

  it("runQuota prints nothing and exits 0 when stdin is a TTY", async () => {
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const stdin = fakeStdin([], true);

    const code = await runQuota(stdin);

    expect(code).toBe(0);
    expect(stdout).not.toHaveBeenCalled();
    stdout.mockRestore();
  });

  it("runQuota prints nothing and exits 0 for malformed JSON on stdin", async () => {
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const stdin = fakeStdin(["{not json"]);

    const code = await runQuota(stdin);

    expect(code).toBe(0);
    expect(stdout).not.toHaveBeenCalled();
    stdout.mockRestore();
  });
});

describe("R5: non-Claude-Code payload — nothing prints", () => {
  it("renderQuotaLines returns [] for a payload shaped like another agent's session (no rate_limits key)", () => {
    const otherAgentPayload = { agent: "codex", session_id: "abc123", model: "gpt-5" };
    expect(renderQuotaLines(otherAgentPayload)).toEqual([]);
  });
});
