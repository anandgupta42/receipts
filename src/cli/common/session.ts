// SPEC-0018 R7: session-resolution helpers shared by the receipt/handoff/mini/
// benchmark commands, under common ownership. Moved verbatim from the pre-refactor
// CLI dispatcher — selector logic still delegates to the parse layer's
// `listFullSessions`/`selectSummary`/`newestSession`; nothing is reimplemented.
import { anyDetected, listFullSessions, listSessions, loadSession, rootsHint, selectSummary } from "../../index.js";
import type { Session, SessionSummary } from "../../parse/types.js";
import { TEMPLATE_NAMES, isTemplateName } from "../../receipt/blocks.js";
import type { TemplateName } from "../../receipt/blocks.js";

// SPEC-0051 R3 — every human "no sessions" message ends with the demo pointer,
// so a first-run on an empty machine still learns how to see a receipt now.
const DEMO_POINTER = "No sessions yet? Run `aireceipts --demo` to see a sample receipt.";

type EmptySessionState = {
  readonly detected: boolean;
  readonly message: string;
};

async function emptySessionState(): Promise<EmptySessionState> {
  const detected = await anyDetected();
  if (!detected) {
    return {
      detected,
      message: `no agent session data detected. Looked in:\n${rootsHint()}\n${DEMO_POINTER}`,
    };
  }
  return { detected, message: `no sessions found\n${DEMO_POINTER}` };
}

export async function noSessionsMessage(): Promise<string> {
  return (await emptySessionState()).message;
}

type SelectorResolution =
  | { summary: SessionSummary; session?: Session }
  | { error: string; kind: "no-session-data" | "no-sessions" | "no-readable-sessions" | "no-match" };

export async function resolveSelector(
  selector: string | undefined,
): Promise<SelectorResolution> {
  if (selector === undefined || selector.trim() === "") {
    // SPEC-0045 R3 — the default receipt shows the NEWEST readable session. A
    // corrupt/unreadable newest is skipped (fall through to the next) rather
    // than erroring; the session is loaded here and returned so the caller
    // renders it without a second load (same load count as before in the common
    // case, where the newest reads fine on the first try).
    const lazy = await listSessions();
    for (const summary of lazy) {
      const session = await loadSession(summary);
      if (session) {
        return { summary, session };
      }
    }
    const empty = await emptySessionState();
    const kind = empty.detected ? (lazy.length === 0 ? "no-sessions" : "no-readable-sessions") : "no-session-data";
    return { error: empty.message, kind };
  }
  const sessions = await listFullSessions();
  if (sessions.length === 0) {
    const empty = await emptySessionState();
    const kind = empty.detected ? "no-sessions" : "no-session-data";
    return { error: empty.message, kind };
  }
  const summary = selectSummary(sessions, selector);
  if (!summary) {
    return { error: `no session matched "${selector}"`, kind: "no-match" };
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
