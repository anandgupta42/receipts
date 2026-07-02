import { describe, expect, it } from "vitest";
import { renderBenchmarkResult, type BenchmarkCohortResponse } from "./response.js";

describe("R4: small-cohort guard", () => {
  it.each([0, 1, 24])("renders 'not enough data yet' for a cohort of %s, never a percentile", (cohortSize) => {
    const response: BenchmarkCohortResponse = { cohortSize, percentile: 90 };
    expect(renderBenchmarkResult(response)).toBe("not enough data yet");
  });

  it("renders a percentile once the cohort reaches exactly 25", () => {
    const response: BenchmarkCohortResponse = { cohortSize: 25, percentile: 50 };
    expect(renderBenchmarkResult(response)).not.toBe("not enough data yet");
  });
});

describe("R5/I6: cohort-comparison framing only, never a ranking", () => {
  it("includes 'vs. a cohort of ... similar sessions' framing", () => {
    const response: BenchmarkCohortResponse = { cohortSize: 40, percentile: 73 };
    expect(renderBenchmarkResult(response)).toContain("vs. a cohort of 40 similar sessions");
  });

  it.each(["better", "worse", "beat", "outperform", "rank", "top ", "worst", "best"])(
    "never contains ranking language: %s",
    (banned) => {
      const response: BenchmarkCohortResponse = { cohortSize: 100, percentile: 12 };
      expect(renderBenchmarkResult(response).toLowerCase()).not.toContain(banned);
    },
  );

  it("small-cohort message also carries no ranking language", () => {
    const response: BenchmarkCohortResponse = { cohortSize: 3, percentile: 99 };
    expect(renderBenchmarkResult(response).toLowerCase()).not.toContain("best");
  });
});
