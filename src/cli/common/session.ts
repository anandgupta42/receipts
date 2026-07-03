// SPEC-0018 R7: session-resolution helpers shared by the receipt/handoff/mini/
// benchmark commands, under common ownership. Moved verbatim from the pre-refactor
// CLI dispatcher — selector logic still delegates to the parse layer's
// `listFullSessions`/`selectSummary`/`newestSession`; nothing is reimplemented.
import { anyDetected, listFullSessions, newestSession, rootsHint, selectSummary } from "../../index.js";
import type { SessionSummary } from "../../parse/types.js";
import { TEMPLATE_NAMES, isTemplateName } from "../../receipt/blocks.js";
import type { TemplateName } from "../../receipt/blocks.js";

export async function noSessionsMessage(): Promise<string> {
  if (!(await anyDetected())) {
    return `no agent session data detected. Looked in:\n${rootsHint()}`;
  }
  return "no sessions found";
}

export async function resolveSelector(
  selector: string | undefined,
): Promise<{ summary: SessionSummary } | { error: string }> {
  if (selector === undefined || selector.trim() === "") {
    const summary = await newestSession();
    if (!summary) {
      return { error: await noSessionsMessage() };
    }
    return { summary };
  }
  const sessions = await listFullSessions();
  if (sessions.length === 0) {
    return { error: await noSessionsMessage() };
  }
  const summary = selectSummary(sessions, selector);
  if (!summary) {
    return { error: `no session matched "${selector}"` };
  }
  return { summary };
}

/** R1: resolve a `--template` string to a name, or report the error listing valid names. */
export function resolveTemplate(template: string | undefined): { template: TemplateName } | { error: string } {
  if (template === undefined) {
    return { template: "classic" };
  }
  if (!isTemplateName(template)) {
    return { error: `unknown template "${template}" — valid: ${TEMPLATE_NAMES.join(", ")}` };
  }
  return { template };
}
