// Pure settings.json manipulation for Claude Code hooks. No I/O lives here —
// `install.ts` owns reads, atomic writes, backup, and the consent prompt.
// Claude Code's hooks are NESTED (`hooks.<event>[].hooks[]` command objects,
// the shape this repo's own `.claude/settings.json` uses), so merge/remove
// operate structurally on that tree and touch nothing else.

/** The exact command string the installed hook runs. Also the identity key for idempotency + uninstall. */
export const HOOK_COMMAND = "npx aireceipts-cli --mini";
export const PRE_PUSH_HOOK_COMMAND = "npx -y aireceipts-cli@latest hook pre-push";

/**
 * Bounded invocation (R6): Claude Code enforces this per-hook `timeout`
 * (seconds) and cancels the command if it overruns, so the hook can never
 * block the agent's exit. Used in place of a shell `timeout` wrapper, which
 * isn't portable to a clean macOS box (no `timeout` binary) — the spike
 * confirmed Claude Code cancels an overrunning SessionEnd hook on its own.
 */
export const HOOK_TIMEOUT_SECONDS = 10;

/**
 * The pre-push hook needs more headroom than the SessionEnd `--mini` render: it
 * runs `npx -y aireceipts-cli@latest`, whose FIRST invocation on a cold npm
 * cache downloads the package (incl. the `@resvg/resvg-js` native dep) before it
 * can write+push the ref. 10s (SessionEnd's value) can expire mid-download, so
 * the first push in a fresh clone would silently miss its receipt. 60s is still
 * a bound (the push is never gated on the receipt; SPEC-0073 R2), just enough for
 * a cold first run. The internal sibling sets no timeout at all (600s default).
 */
export const PRE_PUSH_HOOK_TIMEOUT_SECONDS = 60;

export const SESSION_END_EVENT = "SessionEnd";
export const PRE_TOOL_USE_EVENT = "PreToolUse";

export interface HookCommandSpec {
  event: string;
  matcher: string;
  command: string;
  timeout: number;
}

export const SESSION_END_SPEC: HookCommandSpec = {
  event: SESSION_END_EVENT,
  matcher: "*",
  command: HOOK_COMMAND,
  timeout: HOOK_TIMEOUT_SECONDS,
};

export const PRE_PUSH_SPEC: HookCommandSpec = {
  event: PRE_TOOL_USE_EVENT,
  matcher: "Bash",
  command: PRE_PUSH_HOOK_COMMAND,
  timeout: PRE_PUSH_HOOK_TIMEOUT_SECONDS,
};

export function hookCommandEntry(spec: HookCommandSpec): Record<string, unknown> {
  return {
    matcher: spec.matcher,
    hooks: [{ type: "command", command: spec.command, timeout: spec.timeout }],
  };
}

/** The one nested entry `install-hook` writes under `hooks.SessionEnd` (SPEC-0006 R3). */
export function sessionEndEntry(): Record<string, unknown> {
  return hookCommandEntry(SESSION_END_SPEC);
}

/** The PreToolUse Bash entry adopters can commit for SPEC-0073 auto-attach. */
export function prePushHookEntry(): Record<string, unknown> {
  return hookCommandEntry(PRE_PUSH_SPEC);
}

type Json = Record<string, unknown>;

function isObject(v: unknown): v is Json {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Parse settings text into an object. Empty/whitespace-only input is treated as
 * an empty settings object (a fresh box). Throws on invalid JSON or a non-object
 * top-level value so the caller can abort with NO write (R3).
 */
export function parseSettings(text: string): Json {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return {};
  }
  const parsed: unknown = JSON.parse(trimmed);
  if (!isObject(parsed)) {
    throw new Error("settings.json top-level value is not a JSON object");
  }
  return parsed;
}

function entryHasCommand(entry: unknown, command: string): boolean {
  if (!isObject(entry) || !Array.isArray(entry.hooks)) {
    return false;
  }
  return entry.hooks.some((h) => isObject(h) && h.command === command);
}

function eventArray(settings: Json, event: string): unknown[] {
  const hooks = settings.hooks;
  if (!isObject(hooks)) {
    return [];
  }
  const arr = hooks[event];
  return Array.isArray(arr) ? arr : [];
}

/** True when a command entry is already present under one hook event. */
export function hasHookCommand(settings: Json, event: string, command: string): boolean {
  return eventArray(settings, event).some((entry) => entryHasCommand(entry, command));
}

/** True when our SessionEnd entry is already present (R3 idempotency, R5 no-op detection). */
export function hasHookEntry(settings: Json): boolean {
  return hasHookCommand(settings, SESSION_END_EVENT, HOOK_COMMAND);
}

/** True when the SPEC-0073 PreToolUse auto-attach entry is already present. */
export function hasPrePushHookEntry(settings: Json): boolean {
  return hasHookCommand(settings, PRE_TOOL_USE_EVENT, PRE_PUSH_HOOK_COMMAND);
}

/**
 * A reason string if `settings.hooks` is a shape we must NOT overwrite —
 * present but the wrong type (a non-object `hooks`, or a non-array
 * `hooks.<event>`). The caller aborts with no write rather than silently
 * clobbering valid user JSON (R3: structural preservation). `null` means the
 * tree is safe to merge into.
 */
export function malformedHooksShape(settings: Json, event = SESSION_END_EVENT): string | null {
  if ("hooks" in settings && !isObject(settings.hooks)) {
    return "`hooks` is present but is not a JSON object";
  }
  const hooks = settings.hooks;
  if (isObject(hooks) && event in hooks && !Array.isArray(hooks[event])) {
    return `\`hooks.${event}\` is present but is not an array`;
  }
  return null;
}

function clone(settings: Json): Json {
  return structuredClone(settings);
}

/**
 * Return `settings` with `spec` added under `hooks.<event>`. Additive and
 * structural: existing hooks/keys are preserved untouched. `changed` is false
 * when the command was already present for that event (idempotent no-op).
 */
export function withHookCommand(settings: Json, spec: HookCommandSpec): { next: Json; changed: boolean } {
  if (hasHookCommand(settings, spec.event, spec.command)) {
    return { next: settings, changed: false };
  }
  const next = clone(settings);
  const hooks = isObject(next.hooks) ? next.hooks : {};
  const arr = Array.isArray(hooks[spec.event]) ? (hooks[spec.event] as unknown[]) : [];
  hooks[spec.event] = [...arr, hookCommandEntry(spec)];
  next.hooks = hooks;
  return { next, changed: true };
}

/** Return `settings` with our SessionEnd entry added under `hooks.SessionEnd` (SPEC-0006 R3). */
export function withHookEntry(settings: Json): { next: Json; changed: boolean } {
  return withHookCommand(settings, SESSION_END_SPEC);
}

/** Return `settings` with the SPEC-0073 PreToolUse auto-attach entry added. */
export function withPrePushHookEntry(settings: Json): { next: Json; changed: boolean } {
  return withHookCommand(settings, PRE_PUSH_SPEC);
}

/**
 * Return `settings` with exactly `command` removed from `hooks.<event>`.
 * Removal is surgical: only that `{command}` hook object is stripped from an
 * entry — any sibling hooks in the same entry are preserved (we never remove a
 * parent entry that also carries someone else's hook). An entry whose `hooks[]`
 * we thereby empty is dropped; an emptied `hooks.<event>` array is dropped;
 * a `hooks` object we thereby empty is dropped — no empty scaffolding is left
 * behind. `changed` is false when our command was absent (no-op).
 */
export function withoutHookCommand(settings: Json, event: string, command: string): { next: Json; changed: boolean } {
  if (!hasHookCommand(settings, event, command)) {
    return { next: settings, changed: false };
  }
  const next = clone(settings);
  const hooks = next.hooks as Json;
  const rebuilt: unknown[] = [];
  for (const entry of hooks[event] as unknown[]) {
    if (!entryHasCommand(entry, command) || !isObject(entry)) {
      rebuilt.push(entry);
      continue;
    }
    const remainingHooks = (entry.hooks as unknown[]).filter((h) => !(isObject(h) && h.command === command));
    if (remainingHooks.length > 0) {
      rebuilt.push({ ...entry, hooks: remainingHooks });
    }
  }
  if (rebuilt.length > 0) {
    hooks[event] = rebuilt;
  } else {
    delete hooks[event];
  }
  if (Object.keys(hooks).length === 0) {
    delete next.hooks;
  }
  return { next, changed: true };
}

/** Return `settings` with exactly our SessionEnd hook command removed (SPEC-0006 R5). */
export function withoutHookEntry(settings: Json): { next: Json; changed: boolean } {
  return withoutHookCommand(settings, SESSION_END_EVENT, HOOK_COMMAND);
}

/** Return `settings` with exactly the SPEC-0073 PreToolUse command removed. */
export function withoutPrePushHookEntry(settings: Json): { next: Json; changed: boolean } {
  return withoutHookCommand(settings, PRE_TOOL_USE_EVENT, PRE_PUSH_HOOK_COMMAND);
}

/** Canonical serialization for the written file: 2-space JSON + trailing newline (matches Claude Code's own settings.json style). */
export function serializeSettings(settings: Json): string {
  return `${JSON.stringify(settings, null, 2)}\n`;
}

/**
 * A minimal line diff for the consent prompt (R1). Both inputs are small,
 * pretty-printed JSON that differ by one contiguous insertion (install) or
 * deletion (uninstall), so a common-prefix + common-suffix diff yields the
 * exact minimal change without pulling in a diff dependency. Lines only in
 * `before` are marked `-`, lines only in `after` `+`, with a little context.
 */
export function diffLines(before: string, after: string): string {
  const a = before.length === 0 ? [] : before.replace(/\n$/, "").split("\n");
  const b = after.replace(/\n$/, "").split("\n");
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) {
    start++;
  }
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const out: string[] = [];
  const ctxBefore = Math.max(0, start - 2);
  for (let i = ctxBefore; i < start; i++) {
    out.push(`  ${b[i]}`);
  }
  for (let i = start; i < endA; i++) {
    out.push(`- ${a[i]}`);
  }
  for (let i = start; i < endB; i++) {
    out.push(`+ ${b[i]}`);
  }
  const ctxEnd = Math.min(b.length, endB + 2);
  for (let i = endB; i < ctxEnd; i++) {
    out.push(`  ${b[i]}`);
  }
  return out.join("\n");
}
