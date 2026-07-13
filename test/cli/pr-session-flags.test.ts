import { describe, expect, it, vi } from "vitest";
import type { CommandContext } from "../../src/cli/types.js";

const { runPrDetailed } = vi.hoisted(() => ({
  runPrDetailed: vi.fn(async () => ({
    code: 0,
    bodyRendered: false,
    contributorCount: 0,
    commentResult: "skipped" as const,
    artifactResult: "skipped" as const,
    shareResult: "skipped" as const,
    handoffSectionIncluded: false,
    result: "success" as const,
  })),
}));

vi.mock("../../src/pr/index.js", () => ({ runPrDetailed }));

import { parseOptions } from "../../src/cli/options.js";
import { command as prCommand } from "../../src/cli/commands/pr.js";

describe("PR --session composition (#234)", () => {
  it("retains every repeated selector in argv order, including mixed flag spellings", () => {
    const options = parseOptions([
      "pr",
      "--session",
      "lead",
      "--session=review-one",
      "--session",
      "review-two",
    ]);

    expect(options.prSessions).toEqual(["lead", "review-one", "review-two"]);
    // The legacy scalar is intentionally only populated for the still-supported
    // one-selector mode; it must never expose a misleading last-wins value.
    expect(options.prSession).toBeUndefined();
  });

  it("preserves the legacy scalar for one --session selector", () => {
    const options = parseOptions(["pr", "--session", "lead"]);

    expect(options.prSessions).toEqual(["lead"]);
    expect(options.prSession).toBe("lead");
  });

  it("threads the lossless selector list through the pr command", async () => {
    const options = parseOptions(["pr", "--session", "lead", "--session", "review"]);
    const recordPrFlowCompleted = vi.fn();

    await prCommand.run({
      options,
      telemetry: { recordPrFlowCompleted },
    } as unknown as CommandContext);

    expect(runPrDetailed).toHaveBeenCalledWith(
      expect.objectContaining({ session: undefined, sessions: ["lead", "review"] }),
    );
    expect(recordPrFlowCompleted).toHaveBeenCalledOnce();
  });
});
