/**
 * R4/R5 rendering rules for a benchmark server's response. No server exists
 * yet (v1 ships the client contract only — see SPEC-0015 Purpose), so this
 * shape and renderer are exercised against a stubbed response in tests
 * only; nothing in `src/cli/` calls this today, pending the server spec
 * that will name a real endpoint and response contract.
 */

export interface BenchmarkCohortResponse {
  /** Number of sessions in the comparison cohort. */
  cohortSize: number;
  /** This session's percentile within the cohort, 0-100. */
  percentile: number;
}

const MIN_COHORT_SIZE = 25;

/**
 * R4: a cohort under 25 members never renders a percentile, however
 * confident the number looks — small-sample percentiles are misleading,
 * not just imprecise.
 *
 * R5/I6: framing is always "vs. a cohort of similar sessions" — never
 * "better/worse than X" or any other ranking language.
 */
export function renderBenchmarkResult(response: BenchmarkCohortResponse): string {
  if (response.cohortSize < MIN_COHORT_SIZE) {
    return "not enough data yet";
  }
  return `This session's cost-per-turn is in the ${response.percentile}th percentile vs. a cohort of ${response.cohortSize} similar sessions.`;
}
