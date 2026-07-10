// SPEC-0064 R2-R7 — hidden npm-native PR receipt check. This command never
// generates a receipt in CI; it self-fetches the branch's receipt ref, reuses
// the existing sanitize/render path, and best-effort upserts the marked PR
// comment with GITHUB_TOKEN.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fetchAndRenderReceipt, type FetchRenderDeps, type FetchRenderOutcome } from "../../pr/postRef.js";
import { fetchReceiptRef, readReceiptRef } from "../../pr/store.js";
import { findMarkerComment, type HttpFetch, upsertMarkerComment } from "../../pr/commentApi.js";
import type { CommandContext, CommandDef } from "../types.js";

interface TempRepo {
  cwd: string;
  cleanup(): void;
}

export interface PrCheckDeps {
  http?: HttpFetch;
  fetchAndRender?: typeof fetchAndRenderReceipt;
  fetchRef?: FetchRenderDeps["fetchRef"];
  readRef?: FetchRenderDeps["readRef"];
  findMarker?: typeof findMarkerComment;
  upsertMarker?: typeof upsertMarkerComment;
  makeTempRepo?: () => TempRepo;
}

interface EventContext {
  pr?: string;
  headRepo?: string;
  headRef?: string;
}

interface ResolvedContext {
  baseRepo: string;
  pr: string;
  headRepo: string;
  headRef: string;
  token: string;
  requireSameRepo: boolean;
  sameRepo: boolean;
}

function objectRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

function prValue(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return String(value);
  }
  return stringValue(value);
}

function readEventContext(path: string | undefined): EventContext {
  if (!path) {
    return {};
  }
  try {
    const root = objectRecord(JSON.parse(readFileSync(path, "utf8")));
    const pull = objectRecord(root?.pull_request);
    const head = objectRecord(pull?.head);
    const repo = objectRecord(head?.repo);
    return {
      pr: prValue(pull?.number),
      headRepo: stringValue(repo?.full_name),
      headRef: stringValue(head?.ref),
    };
  } catch {
    return {};
  }
}

function resolveContext(ctx: CommandContext): { ok: true; value: ResolvedContext } | { ok: false; missing: string[] } {
  const event = readEventContext(ctx.env.GITHUB_EVENT_PATH);
  const baseRepo = ctx.options.prBaseRepo ?? ctx.env.GITHUB_REPOSITORY;
  const pr = ctx.options.prNumber ?? event.pr;
  const headRepo = ctx.options.prHeadRepo ?? event.headRepo;
  const headRef = ctx.options.prHeadRef ?? ctx.env.GITHUB_HEAD_REF ?? event.headRef;
  const token = ctx.env.GH_TOKEN ?? ctx.env.GITHUB_TOKEN;
  const requireSameRepo = ctx.options.requireSameRepo || ctx.env.AIRECEIPTS_REQUIRE_PR_RECEIPT === "true";

  const missing: string[] = [];
  if (!baseRepo) missing.push("base repo (--base-repo or GITHUB_REPOSITORY)");
  if (!pr) missing.push("PR number (--pr or pull_request.number)");
  if (!headRepo) missing.push("head repo (--head-repo or pull_request.head.repo.full_name)");
  if (!headRef) missing.push("head ref (--head-ref, GITHUB_HEAD_REF, or pull_request.head.ref)");
  if (!token) missing.push("token (GH_TOKEN or GITHUB_TOKEN)");
  if (!baseRepo || !pr || !headRepo || !headRef || !token) {
    return { ok: false, missing };
  }

  return {
    ok: true,
    value: {
      baseRepo,
      pr,
      headRepo,
      headRef,
      token,
      requireSameRepo,
      sameRepo: headRepo === baseRepo,
    },
  };
}

export function defaultTempRepo(): TempRepo {
  const cwd = mkdtempSync(join(tmpdir(), "aireceipts-prcheck-"));
  const init = spawnSync("git", ["init", "--quiet"], { cwd, encoding: "utf8" });
  if (init.status !== 0) {
    rmSync(cwd, { recursive: true, force: true });
    const stderr = typeof init.stderr === "string" ? init.stderr.trim() : "";
    throw new Error(stderr || "git init failed");
  }
  return {
    cwd,
    cleanup: () => {
      rmSync(cwd, { recursive: true, force: true });
    },
  };
}

async function missingVerdict(ctx: CommandContext, resolved: ResolvedContext, deps: Required<Pick<PrCheckDeps, "findMarker">> & Pick<PrCheckDeps, "http">): Promise<number> {
  const existing = await deps.findMarker(resolved.baseRepo, resolved.pr, resolved.token, deps.http);
  if (existing) {
    ctx.stdout.write("found\n");
    return 0;
  }

  if (resolved.requireSameRepo && resolved.sameRepo) {
    ctx.stdout.write("missing-required\n");
    ctx.stderr.write("pr-check: receipt comment missing for this same-repo PR.\n");
    ctx.stderr.write("Run `npx aireceipts-cli pr --post` locally and rerun this check, or run `npx aireceipts-cli pr --store ref --push-ref` and push again.\n");
    return 1;
  }

  ctx.stdout.write("missing-notice\n");
  return 0;
}

export async function runPrCheck(ctx: CommandContext, deps: PrCheckDeps = {}): Promise<number> {
  const resolved = resolveContext(ctx);
  if (!resolved.ok) {
    ctx.stderr.write(`pr-check: missing required context: ${resolved.missing.join(", ")}\n`);
    return 1;
  }

  const http = deps.http;
  const fetchAndRender = deps.fetchAndRender ?? fetchAndRenderReceipt;
  const fetchRef = deps.fetchRef ?? fetchReceiptRef;
  const readRef = deps.readRef ?? readReceiptRef;
  const findMarker = deps.findMarker ?? findMarkerComment;
  const upsertMarker = deps.upsertMarker ?? upsertMarkerComment;
  const makeTempRepo = deps.makeTempRepo ?? defaultTempRepo;
  const cloneUrl = `https://x-access-token:${resolved.value.token}@github.com/${resolved.value.headRepo}.git`;

  let temp: TempRepo;
  try {
    temp = makeTempRepo();
  } catch (error) {
    ctx.stderr.write(`pr-check: could not initialize temp git repo: ${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }

  let out: FetchRenderOutcome;
  try {
    out = fetchAndRender({ branch: resolved.value.headRef, remoteUrl: cloneUrl, cwd: temp.cwd }, { fetchRef, readRef });
  } finally {
    try {
      temp.cleanup();
    } catch {
      // Best-effort cleanup; the verdict must not depend on tmpdir deletion.
    }
  }

  if (out.code === 0 && out.body) {
    const post = await upsertMarker({ baseRepo: resolved.value.baseRepo, pr: resolved.value.pr, token: resolved.value.token, body: out.body }, http);
    if (post.ok) {
      ctx.stdout.write("found\n");
      ctx.stderr.write(`pr-check: receipt comment ${post.action}\n`);
      return 0;
    }
    ctx.stderr.write(post.readOnly ? `pr-check: ${post.reason}\n` : `pr-check: could not post receipt comment: ${post.reason}\n`);
    return missingVerdict(ctx, resolved.value, { findMarker, http });
  }

  if (out.code === 3) {
    ctx.stderr.write(`pr-check: ${out.message}; treating as missing receipt\n`);
  }
  return missingVerdict(ctx, resolved.value, { findMarker, http });
}

export const command: CommandDef = {
  name: "pr-check",
  priority: 60,
  matches: (options) => options.positional[0] === "pr-check",
  run: (ctx) => runPrCheck(ctx),
};
