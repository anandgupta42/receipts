import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ensureFirstRunNotice, FIRST_RUN_NOTICE } from "./notice.js";

describe("R5: first-run disclosure notice", () => {
  let homeDir: string;

  beforeEach(async () => {
    homeDir = await mkdtemp(join(tmpdir(), "aireceipts-notice-test-"));
  });

  afterEach(async () => {
    await rm(homeDir, { recursive: true, force: true });
  });

  it("shows the notice on the first run and persists that it was shown", async () => {
    const printed: string[] = [];
    const shown = await ensureFirstRunNotice((text) => printed.push(text), homeDir);

    expect(shown).toBe(true);
    expect(printed).toEqual([FIRST_RUN_NOTICE]);
  });

  it("stays silent on the second and third runs", async () => {
    const printed: string[] = [];
    await ensureFirstRunNotice((text) => printed.push(text), homeDir);
    const shownSecondRun = await ensureFirstRunNotice((text) => printed.push(text), homeDir);
    const shownThirdRun = await ensureFirstRunNotice((text) => printed.push(text), homeDir);

    expect(shownSecondRun).toBe(false);
    expect(shownThirdRun).toBe(false);
    expect(printed).toHaveLength(1);
  });

  it("mentions both kill switches, --telemetry-show, and docs/telemetry.md", () => {
    expect(FIRST_RUN_NOTICE).toContain("AIRECEIPTS_TELEMETRY=off");
    expect(FIRST_RUN_NOTICE).toContain("DO_NOT_TRACK=1");
    expect(FIRST_RUN_NOTICE).toContain("--telemetry-show");
    expect(FIRST_RUN_NOTICE).toContain("docs/telemetry.md");
  });

  it("never mentions transcript content, prompts, paths, or dollar amounts as things it sends", () => {
    expect(FIRST_RUN_NOTICE.toLowerCase()).not.toMatch(/\$\d/);
  });

  it("creates the ~/.aireceipts directory on demand when the home override doesn't exist yet", async () => {
    const printed: string[] = [];
    const missingHome = join(homeDir, "does", "not", "exist", "at", "all");
    await expect(ensureFirstRunNotice((text) => printed.push(text), missingHome)).resolves.toBe(true);
    expect(printed).toEqual([FIRST_RUN_NOTICE]);
  });
});
