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
export interface PushClassification {
  attach: boolean;
  reason?: string;
}

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
  const gitIndex = gitCommandIndex(argv);
  if (gitIndex === null) {
    return null;
  }
  const i = gitSubcommandIndex(argv, gitIndex);
  if (i === null) return null;
  const sub = argv[i];
  if (sub === "commit" || sub === "push") {
    return sub;
  }
  return null;
}

function gitCommandIndex(argv: string[]): number | null {
  let i = 0;
  while (i < argv.length && /^[A-Za-z_][A-Za-z0-9_]*=.*/.test(argv[i])) {
    i++;
  }
  if (i >= argv.length || path.basename(argv[i]) !== "git") {
    return null;
  }
  return i;
}

const GIT_GLOBAL_VALUE_OPTIONS = new Set(["-C", "-c", "--git-dir", "--work-tree", "--namespace", "--exec-path"]);

function gitSubcommandIndex(argv: string[], gitIndex: number): number | null {
  let i = gitIndex + 1;
  while (i < argv.length) {
    const tok = argv[i];
    if (GIT_GLOBAL_VALUE_OPTIONS.has(tok)) {
      i += 2;
      continue;
    }
    if (tok.startsWith("--git-dir=") || tok.startsWith("--work-tree=") || tok.startsWith("--namespace=") || tok.startsWith("--exec-path=")) {
      i += 1;
      continue;
    }
    if (tok.startsWith("-")) {
      i += 1;
      continue;
    }
    break;
  }
  return i < argv.length ? i : null;
}

interface ParsedPush {
  remote?: string;
  refspecs: string[];
  dryRun: boolean;
  delete: boolean;
  tags: boolean;
  prune: boolean;
  mirror: boolean;
  all: boolean;
  ambiguous: boolean;
}

const PUSH_VALUE_OPTIONS = new Set(["--receive-pack", "--exec", "--push-option", "--recurse-submodules", "-o"]);
const PUSH_VALUE_PREFIXES = ["--receive-pack=", "--exec=", "--push-option=", "--recurse-submodules=", "--signed="];
const PUSH_VALUE_OR_REMOTE_PREFIXES = ["--repo="];
const PUSH_VALUELESS_OPTIONS = new Set([
  "--atomic",
  "--delete",
  "--dry-run",
  "--follow-tags",
  "--force",
  "--force-if-includes",
  "--force-with-lease",
  "--ipv4",
  "--ipv6",
  "--mirror",
  "--no-atomic",
  "--no-force-if-includes",
  "--no-signed",
  "--no-thin",
  "--no-verify",
  "--porcelain",
  "--progress",
  "--prune",
  "--quiet",
  "--set-upstream",
  "--tags",
  "--thin",
  "--verbose",
]);

function parsePushArgs(args: string[]): ParsedPush {
  const nonOptions: string[] = [];
  let remoteFromRepoOption: string | undefined;
  const parsed: ParsedPush = {
    refspecs: [],
    dryRun: false,
    delete: false,
    tags: false,
    prune: false,
    mirror: false,
    all: false,
    ambiguous: false,
  };
  let stopOptions = false;
  for (let i = 0; i < args.length; i++) {
    const tok = args[i];
    if (stopOptions) {
      nonOptions.push(tok);
      continue;
    }
    if (tok === "--") {
      stopOptions = true;
      continue;
    }
    if (tok === "--repo") {
      remoteFromRepoOption = args[++i];
      if (!remoteFromRepoOption) parsed.ambiguous = true;
      continue;
    }
    const repoPrefix = PUSH_VALUE_OR_REMOTE_PREFIXES.find((prefix) => tok.startsWith(prefix));
    if (repoPrefix) {
      remoteFromRepoOption = tok.slice(repoPrefix.length);
      if (!remoteFromRepoOption) parsed.ambiguous = true;
      continue;
    }
    if (PUSH_VALUE_OPTIONS.has(tok)) {
      i++;
      if (i >= args.length) parsed.ambiguous = true;
      continue;
    }
    if (PUSH_VALUE_PREFIXES.some((prefix) => tok.startsWith(prefix))) {
      continue;
    }
    if (tok.startsWith("--force-with-lease=")) {
      continue;
    }
    if (tok.startsWith("--")) {
      if (tok === "--dry-run") parsed.dryRun = true;
      else if (tok === "--delete") parsed.delete = true;
      else if (tok === "--tags") parsed.tags = true;
      else if (tok === "--prune") parsed.prune = true;
      else if (tok === "--mirror") parsed.mirror = true;
      else if (tok === "--all") parsed.all = true;

      if (!PUSH_VALUELESS_OPTIONS.has(tok) && tok !== "--all") {
        parsed.ambiguous = true;
      }
      continue;
    }
    if (tok.startsWith("-") && tok !== "-") {
      if (!parseShortPushOptions(tok, parsed, args, () => ++i)) {
        parsed.ambiguous = true;
      }
      continue;
    }
    nonOptions.push(tok);
  }

  if (remoteFromRepoOption !== undefined) {
    parsed.remote = remoteFromRepoOption;
    parsed.refspecs = nonOptions;
  } else if (nonOptions.length > 0) {
    parsed.remote = nonOptions[0];
    parsed.refspecs = nonOptions.slice(1);
  }
  return parsed;
}

function parseShortPushOptions(tok: string, parsed: ParsedPush, args: readonly string[], consumeNext: () => number): boolean {
  const flags = tok.slice(1);
  for (let i = 0; i < flags.length; i++) {
    const flag = flags[i];
    if (flag === "n") {
      parsed.dryRun = true;
    } else if (flag === "d") {
      parsed.delete = true;
    } else if (flag === "u" || flag === "f" || flag === "q" || flag === "v" || flag === "4" || flag === "6") {
      continue;
    } else if (flag === "o") {
      if (i < flags.length - 1) {
        return true;
      }
      const next = consumeNext();
      return next < args.length;
    } else {
      return false;
    }
  }
  return true;
}

function falsePush(reason: string): PushClassification {
  return { attach: false, reason };
}

function truePush(): PushClassification {
  return { attach: true };
}

function normalizedRefspec(refspec: string): string {
  return refspec.startsWith("+") ? refspec.slice(1) : refspec;
}

function refspecTarget(refspec: string): string {
  const normalized = normalizedRefspec(refspec);
  const colon = normalized.indexOf(":");
  return colon >= 0 ? normalized.slice(colon + 1) : normalized;
}

// aireceipts writes `refs/aireceipts/*` (store.ts); the legacy/foreign
// `refs/receipts/*` is still matched so another tool's (or an older aireceipts')
// receipt-ref push is never mis-counted as a branch commit anchor.
const RECEIPT_REF_NAMESPACES = ["refs/aireceipts/", "refs/receipts/"] as const;

function isReceiptRef(target: string): boolean {
  return RECEIPT_REF_NAMESPACES.some((ns) => target.startsWith(ns));
}

function isReceiptRefspec(refspec: string): boolean {
  return isReceiptRef(refspecTarget(refspec));
}

function isBranchName(value: string): boolean {
  if (!value || value.startsWith("-") || value.startsWith(":") || value.includes(":") || value.includes("*")) {
    return false;
  }
  if (value === "HEAD" || value === "tag" || value.startsWith("refs/tags/") || isReceiptRef(value)) {
    return false;
  }
  if (/^[0-9a-f]{7,40}$/i.test(value)) {
    return false;
  }
  return true;
}

function isBranchPushRefspec(refspec: string): boolean {
  const normalized = normalizedRefspec(refspec);
  if (normalized.startsWith(":")) {
    return false;
  }
  const colon = normalized.indexOf(":");
  if (colon >= 0) {
    const src = normalized.slice(0, colon);
    const dst = normalized.slice(colon + 1);
    return src === "HEAD" && dst.startsWith("refs/heads/") && dst.length > "refs/heads/".length;
  }
  if (normalized.startsWith("refs/heads/")) {
    return normalized.length > "refs/heads/".length;
  }
  return isBranchName(normalized);
}

/**
 * Classify one already-tokenized argv as a branch push that should auto-attach
 * a receipt ref. Conservative by design: only origin/current-branch push shapes
 * from SPEC-0073 attach; ambiguous or multi-ref writes under-attach.
 */
export function classifyPush(argv: string[]): PushClassification {
  const gitIndex = gitCommandIndex(argv);
  if (gitIndex === null) {
    return falsePush("not-git");
  }
  const subIndex = gitSubcommandIndex(argv, gitIndex);
  if (subIndex === null || argv[subIndex] !== "push") {
    return falsePush("not-push");
  }
  // SPEC-0073 — a repo-retargeting global option (`git -C <dir> push`,
  // `--git-dir`/`--work-tree`/`--namespace`/`--exec-path`) points the push at a
  // DIFFERENT repo/worktree than the hook's cwd, but the attach only ever runs
  // against the hook's own cwd. Attaching would write the ref to the wrong repo,
  // so treat any retargeted push as ambiguous → no attach (under-attach). `-c`
  // (config key=value) does not retarget the repo and is left alone.
  for (let i = gitIndex + 1; i < subIndex; i++) {
    const tok = argv[i];
    if (tok === "-C" || tok === "--git-dir" || tok === "--work-tree" || tok === "--namespace" || tok === "--exec-path") {
      return falsePush("retargeted");
    }
    if (
      tok.startsWith("--git-dir=") ||
      tok.startsWith("--work-tree=") ||
      tok.startsWith("--namespace=") ||
      tok.startsWith("--exec-path=")
    ) {
      return falsePush("retargeted");
    }
  }
  const parsed = parsePushArgs(argv.slice(subIndex + 1));
  if (parsed.ambiguous) {
    return falsePush("ambiguous");
  }
  if (parsed.dryRun) return falsePush("dry-run");
  if (parsed.delete) return falsePush("delete");
  if (parsed.mirror) return falsePush("mirror");
  if (parsed.all) return falsePush("all");
  if (parsed.remote !== undefined && parsed.remote !== "origin") {
    return falsePush("non-origin");
  }
  if (parsed.refspecs.length === 0) {
    if (parsed.tags) return falsePush("tags-only");
    if (parsed.prune) return falsePush("prune-only");
    return truePush();
  }
  if (parsed.refspecs.length !== 1) {
    return falsePush("ambiguous-refspecs");
  }
  const refspec = parsed.refspecs[0];
  if (isReceiptRefspec(refspec)) {
    return falsePush("receipts-ref");
  }
  if (!isBranchPushRefspec(refspec)) {
    return falsePush("not-branch-refspec");
  }
  return truePush();
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
