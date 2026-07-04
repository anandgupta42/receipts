// Pure settings.json manipulation for the SessionEnd auto-receipt hook
// (SPEC-0006 R1/R3/R5). No I/O lives here — `install.ts` owns reads, atomic
// writes, backup, and the consent prompt. Claude Code's hooks are NESTED
// (`hooks.SessionEnd[].hooks[]` command objects, the shape this repo's own
// `.claude/settings.json` uses), so merge/remove operate structurally on that
// tree and touch nothing else (R3: every other key deep-equal before/after).

/** The exact command string the installed hook runs. Also the identity key for idempotency + uninstall. */
export const HOOK_COMMAND = "npx aireceipts-cli --mini";

/**
 * Bounded invocation (R6): Claude Code enforces this per-hook `timeout`
 * (seconds) and cancels the command if it overruns, so the hook can never
 * block the agent's exit. Used in place of a shell `timeout` wrapper, which
 * isn't portable to a clean macOS box (no `timeout` binary) — the spike
 * confirmed Claude Code cancels an overrunning SessionEnd hook on its own.
 */
export const HOOK_TIMEOUT_SECONDS = 10;

export const SESSION_END_EVENT = "SessionEnd";

/** The one nested entry `install-hook` writes under `hooks.SessionEnd` (R3). */
export function sessionEndEntry(): Record<string, unknown> {
  return {
    matcher: "*",
    hooks: [{ type: "command", command: HOOK_COMMAND, timeout: HOOK_TIMEOUT_SECONDS }],
  };
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

function entryIsOurs(entry: unknown): boolean {
  if (!isObject(entry) || !Array.isArray(entry.hooks)) {
    return false;
  }
  return entry.hooks.some((h) => isObject(h) && h.command === HOOK_COMMAND);
}

function sessionEndArray(settings: Json): unknown[] {
  const hooks = settings.hooks;
  if (!isObject(hooks)) {
    return [];
  }
  const arr = hooks[SESSION_END_EVENT];
  return Array.isArray(arr) ? arr : [];
}

/** True when our SessionEnd entry is already present (R3 idempotency, R5 no-op detection). */
export function hasHookEntry(settings: Json): boolean {
  return sessionEndArray(settings).some(entryIsOurs);
}

/**
 * A reason string if `settings.hooks` is a shape we must NOT overwrite —
 * present but the wrong type (a non-object `hooks`, or a non-array
 * `hooks.SessionEnd`). The caller aborts with no write rather than silently
 * clobbering valid user JSON (R3: structural preservation). `null` means the
 * tree is safe to merge into.
 */
export function malformedHooksShape(settings: Json): string | null {
  if ("hooks" in settings && !isObject(settings.hooks)) {
    return "`hooks` is present but is not a JSON object";
  }
  const hooks = settings.hooks;
  if (isObject(hooks) && SESSION_END_EVENT in hooks && !Array.isArray(hooks[SESSION_END_EVENT])) {
    return "`hooks.SessionEnd` is present but is not an array";
  }
  return null;
}

function clone(settings: Json): Json {
  return structuredClone(settings);
}

/**
 * Return `settings` with our SessionEnd entry added under `hooks.SessionEnd`
 * (R3). Additive and structural: existing hooks/keys are preserved untouched.
 * `changed` is false when the entry was already present (idempotent no-op).
 */
export function withHookEntry(settings: Json): { next: Json; changed: boolean } {
  if (hasHookEntry(settings)) {
    return { next: settings, changed: false };
  }
  const next = clone(settings);
  const hooks = isObject(next.hooks) ? next.hooks : {};
  const arr = Array.isArray(hooks[SESSION_END_EVENT]) ? (hooks[SESSION_END_EVENT] as unknown[]) : [];
  hooks[SESSION_END_EVENT] = [...arr, sessionEndEntry()];
  next.hooks = hooks;
  return { next, changed: true };
}

/**
 * Return `settings` with exactly our hook command removed (R5). Removal is
 * surgical: only the `{command: HOOK_COMMAND}` hook object is stripped from an
 * entry — any sibling hooks in the same entry are preserved (we never remove a
 * parent entry that also carries someone else's hook). An entry whose `hooks[]`
 * we thereby empty is dropped; an emptied `hooks.SessionEnd` array is dropped;
 * a `hooks` object we thereby empty is dropped — no empty scaffolding is left
 * behind. `changed` is false when our command was absent (no-op).
 */
export function withoutHookEntry(settings: Json): { next: Json; changed: boolean } {
  if (!hasHookEntry(settings)) {
    return { next: settings, changed: false };
  }
  const next = clone(settings);
  const hooks = next.hooks as Json;
  const rebuilt: unknown[] = [];
  for (const entry of hooks[SESSION_END_EVENT] as unknown[]) {
    if (!entryIsOurs(entry) || !isObject(entry)) {
      rebuilt.push(entry);
      continue;
    }
    const remainingHooks = (entry.hooks as unknown[]).filter((h) => !(isObject(h) && h.command === HOOK_COMMAND));
    if (remainingHooks.length > 0) {
      rebuilt.push({ ...entry, hooks: remainingHooks });
    }
  }
  if (rebuilt.length > 0) {
    hooks[SESSION_END_EVENT] = rebuilt;
  } else {
    delete hooks[SESSION_END_EVENT];
  }
  if (Object.keys(hooks).length === 0) {
    delete next.hooks;
  }
  return { next, changed: true };
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
