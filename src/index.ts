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

export { adapterFor, adapters, agentIds, detectedAdapters } from "./parse/registry.js";
export { anyDetected, listSessions, listFullSessions, loadById, loadSession, newestSession, rootsHint, selectSummary } from "./parse/load.js";

export type { PriceRow, PriceSource, PriceTable, ResolvedPrice } from "./pricing/types.js";
export { defaultDataDir, loadPriceTable } from "./pricing/priceTable.js";
export { cheapestCurrentRow, costOf, isoDateOf, priceTurn, resolvePrice, vendorForModel, vendorForSource } from "./pricing/resolve.js";
export type { AttributionResult, ToolAttribution } from "./pricing/attribution.js";
export { attributeByTool, METHODOLOGY } from "./pricing/attribution.js";
export type { PriceDeltaFootnote, StuckLoopFinding, TrivialSpansFinding } from "./pricing/waste.js";
export { detectStuckLoops, detectTrivialSpans, priceDeltaFootnote } from "./pricing/waste.js";

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
