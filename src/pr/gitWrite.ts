// SPEC-0019 R1e(b)(c) — the tokenized git-write matcher and output-only hex-run
// authorship. Load-bearing (ported from the maintainer's prior tooling): an
// orchestrator running `codex exec "…then git push…"` must NEVER be read as a
// real `git push` — substring matching is forbidden, so we tokenize the command
// (respecting quotes) and only match `git` as the actual argv[0] with
// `commit`/`push` as its subcommand. Authorship is decided ONLY from a span's
// OUTPUT: a SHA in a command's INPUT is never authorship.
import * as path from "node:path";
import type { ToolCall } from "../parse/types.js";

export type GitVerb = "commit" | "push";

/** Shells whose `-c`/`-lc` script argument we recurse into (a real `git commit`
 * wrapped as `bash -lc "git commit …"`). `codex`/other launchers are NOT shells
 * and are never recursed — that is exactly what keeps `codex exec "…git push…"`
 * from matching. */
const SHELLS = new Set(["sh", "bash", "zsh", "dash"]);
const SHELL_C_FLAGS = new Set(["-c", "-lc", "-ic", "-lic"]);

type LexToken = { kind: "word"; value: string } | { kind: "op" };

/**
 * Minimal shell lexer: splits into word tokens and operator boundaries
 * (`&&`, `||`, `;`, `|`, newline), honoring `'…'` and `"…"` quoting so an
 * operator or the word `git` INSIDE a quoted string never starts a new command.
 * Escapes are handled just enough for command identification (not a full shell).
 */
function lex(input: string): LexToken[] {
  const tokens: LexToken[] = [];
  let word = "";
  let hasWord = false;
  const pushWord = () => {
    if (hasWord) {
      tokens.push({ kind: "word", value: word });
      word = "";
      hasWord = false;
    }
  };
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (c === "'" || c === '"') {
      hasWord = true;
      const quote = c;
      i++;
      while (i < input.length && input[i] !== quote) {
        if (quote === '"' && input[i] === "\\" && i + 1 < input.length) {
          i++;
        }
        word += input[i];
        i++;
      }
      continue;
    }
    if (c === "\\" && i + 1 < input.length) {
      hasWord = true;
      word += input[i + 1];
      i++;
      continue;
    }
    if (c === "&" && input[i + 1] === "&") {
      pushWord();
      tokens.push({ kind: "op" });
      i++;
      continue;
    }
    if (c === "|" && input[i + 1] === "|") {
      pushWord();
      tokens.push({ kind: "op" });
      i++;
      continue;
    }
    if (c === ";" || c === "|" || c === "\n") {
      pushWord();
      tokens.push({ kind: "op" });
      continue;
    }
    if (c === " " || c === "\t" || c === "\r") {
      pushWord();
      continue;
    }
    hasWord = true;
    word += c;
  }
  pushWord();
  return tokens;
}

/** Group a lexed token stream into individual argv commands split at operators. */
function commandsFromTokens(tokens: LexToken[]): string[][] {
  const commands: string[][] = [];
  let current: string[] = [];
  for (const t of tokens) {
    if (t.kind === "op") {
      if (current.length > 0) {
        commands.push(current);
      }
      current = [];
    } else {
      current.push(t.value);
    }
  }
  if (current.length > 0) {
    commands.push(current);
  }
  return commands;
}

/** Tokenize a raw command string into its constituent argv commands. */
function commandsFromString(input: string): string[][] {
  return commandsFromTokens(lex(input));
}

/**
 * Extract the raw command from a tool call's input across the shapes we see:
 * Claude's `{command: "…"}` object, and Codex's `{command: […]}` /
 * `{cmd: "…" | […]}` argv-or-string. Returns argv arrays already-split when the
 * source is a literal argv, or a single-element `{ raw }` for a shell string to
 * be tokenized. Anything else → no commands.
 */
function rawInvocations(input: unknown): string[][] {
  if (!input || typeof input !== "object") {
    return typeof input === "string" ? commandsFromString(input) : [];
  }
  const obj = input as Record<string, unknown>;
  const source = obj.command ?? obj.cmd;
  if (typeof source === "string") {
    return commandsFromString(source);
  }
  if (Array.isArray(source) && source.every((s) => typeof s === "string")) {
    // A literal argv — one command, not tokenized (quoted args stay whole, so
    // `codex exec "…git push…"` cannot be mis-split).
    return [source as string[]];
  }
  return [];
}

/** Recursively resolve shell-wrapper argvs (`bash -lc "git commit …"`) into the real commands. */
function resolveInvocations(argvs: string[][], depth = 0): string[][] {
  if (depth > 3) {
    return argvs;
  }
  const out: string[][] = [];
  for (const argv of argvs) {
    if (argv.length === 0) {
      continue;
    }
    const base = path.basename(argv[0]);
    if (SHELLS.has(base)) {
      const flagIdx = argv.findIndex((a) => SHELL_C_FLAGS.has(a));
      const script = flagIdx >= 0 ? argv[flagIdx + 1] : undefined;
      if (typeof script === "string") {
        out.push(...resolveInvocations(commandsFromString(script), depth + 1));
        continue;
      }
    }
    out.push(argv);
  }
  return out;
}

/**
 * If `argv` is a real `git commit`/`git push` invocation, return the verb;
 * otherwise `null`. Global options before the subcommand (`-C <path>`,
 * `-c <k=v>`, `--no-pager`, …) are skipped; the first non-option token must be
 * the subcommand.
 */
export function gitWriteVerb(argv: string[]): GitVerb | null {
  if (argv.length === 0 || path.basename(argv[0]) !== "git") {
    return null;
  }
  let i = 1;
  while (i < argv.length) {
    const tok = argv[i];
    if (tok === "-C" || tok === "-c") {
      i += 2; // option with a value
      continue;
    }
    if (tok.startsWith("-")) {
      i += 1; // valueless global option
      continue;
    }
    break;
  }
  const sub = argv[i];
  if (sub === "commit" || sub === "push") {
    return sub;
  }
  return null;
}

/** The single git-write verb this tool call represents, if any (first match
 * across compound commands). SPEC-0038 R1a: only adapter-flagged REAL shell
 * executions can mint verbs — Agent/Task results, MCP tools carrying `command`
 * fields, and quoted echoes are categorically excluded. */
export function toolCallGitVerb(call: ToolCall): GitVerb | null {
  if (call.shell !== true) {
    return null;
  }
  for (const argv of toolCallInvocations(call)) {
    const verb = gitWriteVerb(argv);
    if (verb) {
      return verb;
    }
  }
  return null;
}

/**
 * The resolved argv commands a tool call invokes (quote-respecting, shell
 * wrappers unwrapped) — the same tokenized view `toolCallGitVerb` uses, exposed
 * so other classifiers (SPEC-0023's `codex exec` launch detection) can match on
 * a real argv[0] rather than a substring (an orchestrator that merely echoes
 * "codex exec" in a string must not count).
 */
export function toolCallInvocations(call: ToolCall): string[][] {
  return resolveInvocations(rawInvocations(call.input));
}

/** True if `argv` is a real `codex exec …` invocation (argv[0] is `codex`, first non-option token is `exec`). */
export function isCodexExec(argv: string[]): boolean {
  if (argv.length === 0 || path.basename(argv[0]) !== "codex") {
    return false;
  }
  const sub = argv.slice(1).find((tok) => !tok.startsWith("-"));
  return sub === "exec";
}

const HEX_RUN_RE = /[0-9a-f]{7,40}/g;

/** All hex runs of ≥7 chars in `text` (git short/long SHAs; liberal — the SHA-prefix check filters). */
export function hexRuns(text: string): string[] {
  return text.match(HEX_RUN_RE) ?? [];
}

/** A hex run is OURS iff it prefix-matches (is a prefix of) some branch SHA. */
export function matchesBranchSha(run: string, branchShas: readonly string[]): boolean {
  return branchShas.some((sha) => sha.startsWith(run));
}

// ── SPEC-0038 R1b — write-output line grammars ──────────────────────────────
// Anchor SHAs are taken only from output lines shaped like git's own write
// confirmations, never from the whole blob: a compound command
// (`git commit … && git log --oneline`) yields ONE output where other commits'
// SHAs sit inside a write span, and a name gate alone cannot see the difference.
//   commit: `[<ref> <sha>] subject`, incl. `[<ref> (root-commit) <sha>]`
//   push:   ` <old>..<new>  <ref> -> <ref>` (fast-forward), `+ <old>...<new>`
//           (forced) — the update-line pair; `* [new branch] a -> b` has no SHA.
const COMMIT_LINE_RE = /^\[[^\]\n]* ([0-9a-f]{7,40})\]/;
// Push update lines always name the ref mapping on the same line (`a..b ref ->
// ref`, `+ a...b ref -> ref (forced)`, `sha -> ref` for SHA-spec pushes) — the
// ` -> ` requirement is what keeps a `git log a..b` echo inside a compound
// push span inert (S5 finding 2). Only the NEW sha is authorship: the old tip
// was someone's prior work, not this span's (under-credit-only direction).
const PUSH_UPDATE_RE = /(?:^|\s)(?:[0-9a-f]{7,40})\.\.\.?([0-9a-f]{7,40})\s+\S+ -> \S+/;
const PUSH_SHA_REF_RE = /(?:^|\s)([0-9a-f]{7,40}) -> \S+/;

/**
 * The SHAs a git-write span's output actually confirms, per the verb's own
 * line grammar (SPEC-0038 R1b). Lines not matching the grammar contribute
 * nothing — `git log` echoes, prose SHAs, and notification quotes are inert.
 */
export function writeOutputShas(verb: GitVerb, output: string): string[] {
  const shas: string[] = [];
  for (const line of output.split("\n")) {
    if (verb === "commit") {
      const m = COMMIT_LINE_RE.exec(line.trim());
      if (m) {
        shas.push(m[1]);
      }
    } else {
      const upd = PUSH_UPDATE_RE.exec(line);
      if (upd) {
        shas.push(upd[1]);
        continue;
      }
      const shaRef = PUSH_SHA_REF_RE.exec(line);
      if (shaRef) {
        shas.push(shaRef[1]);
      }
    }
  }
  return shas;
}
