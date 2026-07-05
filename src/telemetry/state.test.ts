import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ensureInstallId, installHashOf, readState, updateState } from "./state.js";

describe("SPEC-0043 R7 local telemetry state", () => {
  let home: string;

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "aireceipts-state-"));
  });

  afterEach(async () => {
    await rm(home, { recursive: true, force: true });
  });

  const path = (): string => join(home, ".aireceipts", "state.json");

  it("missing state reads as zero counters", async () => {
    await expect(readState(home)).resolves.toEqual({ schemaVersion: 1, runCount: 0, receiptCount: 0, milestones: {} });
  });

  it("corrupt state self-heals on the next successful update", async () => {
    await writeFile(path(), "{not json", "utf8").catch(async () => {
      await updateState(() => {}, home);
      await writeFile(path(), "{not json", "utf8");
    });

    const state = await updateState((s) => {
      s.runCount += 1;
    }, home);

    expect(state?.runCount).toBe(1);
    const raw = await readFile(path(), "utf8");
    expect(() => JSON.parse(raw)).not.toThrow();
  });

  it("concurrent last-write-wins updates leave valid JSON", async () => {
    await Promise.all([
      updateState((s) => {
        s.runCount += 1;
      }, home),
      updateState((s) => {
        s.receiptCount += 1;
      }, home),
    ]);

    const parsed = JSON.parse(await readFile(path(), "utf8")) as { schemaVersion?: unknown };
    expect(parsed.schemaVersion).toBe(1);
  });

  it("creates a random install id only when telemetry is enabled", async () => {
    const disabled = await updateState((s) => {
      ensureInstallId(s, false);
    }, home);
    expect(disabled?.installId).toBeUndefined();

    const enabled = await updateState((s) => {
      ensureInstallId(s, true);
    }, home);
    expect(enabled?.installId).toMatch(/^[0-9a-f-]{36}$/);
    expect(installHashOf(enabled!.installId!)).toMatch(/^[0-9a-f]{64}$/);
    expect(installHashOf(enabled!.installId!)).not.toBe(enabled!.installId);
  });

  it("drops a non-UUID installId from a tampered/corrupt state file (never hash free text)", async () => {
    await updateState((s) => {
      s.runCount = 4;
    }, home);
    const tampered = JSON.parse(await readFile(path(), "utf8")) as Record<string, unknown>;
    tampered.installId = "/Users/alice/secret-repo";
    await writeFile(path(), JSON.stringify(tampered), "utf8");

    const read = await readState(home);
    expect(read.installId).toBeUndefined();
    expect(read.runCount).toBe(4);

    const regenerated = await updateState((s) => {
      ensureInstallId(s, true);
    }, home);
    expect(regenerated?.installId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  });
});
