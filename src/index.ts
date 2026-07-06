// Public library entry point for M1's receipt engine.
export type {
  AgentSource,
  Session,
  SessionAdapter,
  SessionSummary,
  SessionTotals,
  TokenUsage,
  ToolCall,
  ToolCallStatus,
  Turn,
} from "./parse/types.js";
export { SOURCE_LABELS } from "./parse/types.js";

export { ClaudeCodeAdapter } from "./parse/claudeCode.js";
export { CodexAdapter } from "./parse/codex.js";
export { CursorAdapter } from "./parse/cursor.js";
export { GeminiAdapter } from "./parse/gemini.js";
export { OpenCodeAdapter } from "./parse/opencode.js";

export { adapterFor, adapters, agentIds, detectedAdapters } from "./parse/registry.js";
export { anyDetected, listSessions, listFullSessions, loadById, loadSession, newestSession, rootsHint, selectSummary } from "./parse/load.js";

export type { PriceRow, PriceSource, PriceTable, ResolvedPrice } from "./pricing/types.js";
export { defaultDataDir, loadPriceTable } from "./pricing/priceTable.js";
export { cheapestCurrentRow, costOf, isoDateOf, priceTurn, resolvePrice, vendorForModel, vendorForSource, vendorForTurn } from "./pricing/resolve.js";
export type { AttributionResult, ToolAttribution } from "./pricing/attribution.js";
export { attributeByTool, METHODOLOGY } from "./pricing/attribution.js";
export type { ContextThrashFinding, PriceDeltaFootnote, StuckLoopFinding, TrivialSpansFinding } from "./pricing/waste.js";
export { detectContextThrash, detectStuckLoops, detectTrivialSpans, priceDeltaFootnote } from "./pricing/waste.js";

// SPEC-0008 weekly digest + the shared waste-aggregation primitive (also consumed by SPEC-0013).
export type { WasteClassAggregate } from "./aggregate/waste.js";
export { aggregateWaste } from "./aggregate/waste.js";
export { deriveProjectBucket, UNKNOWN_PROJECT } from "./aggregate/project.js";
export type {
  AgentSplit,
  ProjectSplit,
  WeekDelta,
  WeekDigest,
  WeekOptions,
  WindowAggregate,
  WindowBounds,
} from "./aggregate/week.js";
export {
  aggregateWindow,
  assembleWeekDigest,
  buildWeekDigest,
  computeDelta,
  partitionWindows,
  windowBounds,
} from "./aggregate/week.js";
export { renderWeek, weekToJson } from "./receipt/week.js";

// SPEC-0056 backfill — bulk retroactive receipt sweep.
export type { BackfillFilters, BackfillPlan, BackfillPlanEntry } from "./aggregate/backfill.js";
export { backfillFileName, buildManifest, filterSummaries, MANIFEST_MARKER, planBackfill, slugForId } from "./aggregate/backfill.js";
export type { BackfillReport, BackfillReportEntry } from "./receipt/backfill.js";
export { backfillToJson, renderBackfillSummary } from "./receipt/backfill.js";
