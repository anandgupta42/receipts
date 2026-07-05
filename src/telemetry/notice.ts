import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/**
 * One-time diagnostics-telemetry disclosure (SPEC-0002 R5). Persists
 * `{shown: true}` at `~/.aireceipts/telemetry.json`, mirroring SPEC-0009's
 * `~/.aireceipts/budget.json` config-dir convention. Read/write failures
 * (no home dir, read-only filesystem, corrupt JSON) are treated as "not
 * shown yet" for *this run only* and never thrown — a broken filesystem
 * degrades to "print the notice again next time," never to a crash (I1).
 */

export const FIRST_RUN_NOTICE =
  "aireceipts sends anonymous, content-free diagnostics and feature-usage " +
  "events (command, coarse buckets, and a random install identifier — never " +
  "transcript content, prompts, file paths, repo names, or dollar amounts). " +
  "Disable anytime with AIRECEIPTS_TELEMETRY=off or DO_NOT_TRACK=1. Run --telemetry-show to see " +
  "exactly what a run would send. Details: docs/telemetry.md";

interface NoticeState {
  shown: boolean;
}

/**
 * Resolved at call time (not module load). `AIRECEIPTS_HOME` redirects the
 * config dir exactly like the budget and summary-cache paths do
 * (src/budget/config.ts:16, src/parse/summaryCache.ts:23) — the notice was
 * the one `.aireceipts` file that ignored it, which also broke test
 * isolation under worker threads, where `os.homedir()` cannot see a
 * worker-local `HOME` mutation but a call-time `process.env` read can.
 */
function noticeStatePath(homeOverride?: string): string {
  return join(homeOverride ?? process.env.AIRECEIPTS_HOME ?? homedir(), ".aireceipts", "telemetry.json");
}

async function readNoticeState(path: string): Promise<NoticeState> {
  try {
    const raw = await readFile(path, "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && "shown" in parsed && typeof (parsed as NoticeState).shown === "boolean") {
      return parsed as NoticeState;
    }
    return { shown: false };
  } catch {
    return { shown: false };
  }
}

async function writeNoticeState(path: string, state: NoticeState): Promise<void> {
  try {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify(state), "utf8");
  } catch {
    // Fail-safe (I1): a write failure just means the notice reprints next run.
  }
}

/**
 * Prints (via `print`) {@link FIRST_RUN_NOTICE} the first time this ever
 * runs for the current user, then persists that it's been shown so later
 * runs stay silent. Returns `true` if the notice was (just) shown.
 */
export async function ensureFirstRunNotice(print: (text: string) => void, homeOverride?: string): Promise<boolean> {
  const path = noticeStatePath(homeOverride);
  const state = await readNoticeState(path);
  if (state.shown) {
    return false;
  }
  print(FIRST_RUN_NOTICE);
  await writeNoticeState(path, { shown: true });
  return true;
}
