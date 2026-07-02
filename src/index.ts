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

export { adapterFor, adapters, agentIds, detectedAdapters } from "./parse/registry.js";
export { anyDetected, listSessions, loadById, loadSession, rootsHint, selectSummary } from "./parse/load.js";

export type { PriceRow, PriceSource, PriceTable, ResolvedPrice } from "./pricing/types.js";
export { defaultDataDir, loadPriceTable } from "./pricing/priceTable.js";
export { cheapestCurrentRow, costOf, isoDateOf, priceTurn, resolvePrice, vendorForSource } from "./pricing/resolve.js";
export type { AttributionResult, ToolAttribution } from "./pricing/attribution.js";
export { attributeByTool, METHODOLOGY } from "./pricing/attribution.js";
export type { PriceDeltaFootnote, StuckLoopFinding, TrivialSpansFinding } from "./pricing/waste.js";
export { detectStuckLoops, detectTrivialSpans, priceDeltaFootnote } from "./pricing/waste.js";
