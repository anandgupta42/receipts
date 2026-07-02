import { ClaudeCodeAdapter } from "./claudeCode.js";
import { CodexAdapter } from "./codex.js";
import { CursorAdapter } from "./cursor.js";
import { GeminiAdapter } from "./gemini.js";
import type { AgentSource, SessionAdapter } from "./types.js";

const ADAPTERS: SessionAdapter[] = [new ClaudeCodeAdapter(), new CodexAdapter(), new CursorAdapter(), new GeminiAdapter()];

/** All registered adapters, in a stable order. */
export function adapters(): SessionAdapter[] {
  return ADAPTERS;
}

/** The adapter for a given source id, or `undefined` if unknown. */
export function adapterFor(source: AgentSource): SessionAdapter | undefined {
  return ADAPTERS.find((a) => a.id === source);
}

/** The ids of all registered adapters. */
export function agentIds(): AgentSource[] {
  return ADAPTERS.map((a) => a.id);
}

/** Adapters whose transcript root is present on this machine. Detection failures degrade to "not detected", never throw. */
export async function detectedAdapters(): Promise<SessionAdapter[]> {
  const flags = await Promise.all(ADAPTERS.map((a) => a.detect().catch(() => false)));
  return ADAPTERS.filter((_, i) => flags[i]);
}
