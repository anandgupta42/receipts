import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import { parseOptions } from "../../src/cli/options.js";
import type { CommandContext } from "../../src/cli/types.js";
import { command, defaultTempRepo, runPrCheck, type PrCheckDeps } from "../../src/cli/commands/pr-check.js";
import { DOGFOOD_MARKER, renderPrBody } from "../../src/pr/body.js";
import { fetchAndRenderReceipt, renderReceiptPayload, type FetchRenderArgs, type FetchRenderOutcome } from "../../src/pr/postRef.js";
import { PR_RECEIPT_SCHEMA_VERSION, type PrReceiptPayload } from "../../src/pr/payloadTypes.js";
import { sanitizePrReceiptPayload } from "../../src/pr/sanitize.js";
import { serializePrReceipt } from "../../src/pr/payload.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

function stdinStub(): NodeJS.ReadStream {
  const stream = Readable.from([]) as unknown as NodeJS.ReadStream;
  (stream as unknown as { isTTY: boolean }).isTTY = false;
  return stream;
}

function fakeContext(argv: string[], env: NodeJS.ProcessEnv): { ctx: CommandContext; out: () => string; err: () => string } {
  let out = "";
  let err = "";
  const stdout = { write: (s: string) => ((out += s), true) } as unknown as NodeJS.WriteStream;
  const stderr = { write: (s: string) => ((err += s), true) } as unknown as NodeJS.WriteStream;
  const ctx = {
    options: parseOptions(argv),
    stdin: stdinStub(),
    stdout,
    stderr,
    env,
    cwd: () => process.cwd(),
    now: () => 0,
    fs: { writeFile: async () => {} },
    prompt: async () => false,
    telemetry: {
      showPayload: () => ({ enabled: false, events: [] }),
      noteReceiptGenerated: async () => {},
      recordExportGenerated: () => {},
      recordPrFlowCompleted: () => {},
      recordHookConfigured: () => {},
      recordIntegrationSurfaceRendered: () => {},
      noteMilestone: async () => {},
    },
    renderHelp: () => "",
  } as unknown as CommandContext;
  return { ctx, out: () => out, err: () => err };
}

function eventFile(headRepo: string, headRef: string, pr = 12): string {
  const dir = mkdtempSync(path.join(tmpdir(), "aireceipts-prcheck-test-"));
  const file = path.join(dir, "event.json");
  writeFileSync(file, JSON.stringify({ pull_request: { number: pr, head: { repo: { full_name: headRepo }, ref: headRef } } }), "utf8");
  return file;
}

function tempRepoDeps(): { makeTempRepo: NonNullable<PrCheckDeps["makeTempRepo"]>; cleaned: () => boolean } {
  let cleaned = false;
  return {
    makeTempRepo: () => ({
      cwd: "/tmp/aireceipts-prcheck-fake",
      cleanup: () => {
        cleaned = true;
      },
    }),
    cleaned: () => cleaned,
  };
}

function foundBody(body = `${DOGFOOD_MARKER}\nbody`): FetchRenderOutcome {
  return { code: 0, body, message: "rendered" };
}

describe("SPEC-0064 pr-check", () => {
  it("matches the hidden `pr-check` positional only", () => {
    expect(command.matches(parseOptions(["pr-check"]))).toBe(true);
    expect(command.matches(parseOptions(["pr-render-ref"]))).toBe(false);
  });

  it("resolves Actions env context and fetches from the fork head repo", async () => {
    let capturedFetch: FetchRenderArgs | undefined;
    let capturedPost: { baseRepo: string; pr: string | number; token: string; body: string } | undefined;
    const temp = tempRepoDeps();
    const { ctx, out } = fakeContext(["pr-check"], {
      GITHUB_REPOSITORY: "base/repo",
      GITHUB_EVENT_PATH: eventFile("fork/repo", "feature/ref", 17),
      GITHUB_TOKEN: "tok",
    });

    const exit = await runPrCheck(ctx, {
      makeTempRepo: temp.makeTempRepo,
      fetchAndRender: (args) => {
        capturedFetch = args;
        return foundBody();
      },
      upsertMarker: async (args) => {
        capturedPost = args;
        return { ok: true, action: "created" };
      },
      findMarker: async () => null,
    });

    expect(exit).toBe(0);
    expect(out()).toBe("found\n");
    expect(capturedFetch).toEqual({
      branch: "feature/ref",
      remoteUrl: "https://x-access-token:tok@github.com/fork/repo.git",
      cwd: "/tmp/aireceipts-prcheck-fake",
    });
    expect(capturedPost).toMatchObject({ baseRepo: "base/repo", pr: "17", token: "tok" });
    expect(temp.cleaned()).toBe(true);
  });

  it("lets flags override event/env context", async () => {
    let capturedFetch: FetchRenderArgs | undefined;
    let capturedPost: { baseRepo: string; pr: string | number; token: string; body: string } | undefined;
    const { ctx } = fakeContext(["pr-check", "--pr=9", "--base-repo=flag/base", "--head-repo", "flag/head", "--head-ref", "flag-branch"], {
      GITHUB_REPOSITORY: "env/base",
      GITHUB_EVENT_PATH: eventFile("env/head", "env-branch", 2),
      GH_TOKEN: "gh-token",
      GITHUB_TOKEN: "github-token",
    });

    await runPrCheck(ctx, {
      makeTempRepo: tempRepoDeps().makeTempRepo,
      fetchAndRender: (args) => {
        capturedFetch = args;
        return foundBody();
      },
      upsertMarker: async (args) => {
        capturedPost = args;
        return { ok: true, action: "updated" };
      },
      findMarker: async () => null,
    });

    expect(capturedFetch?.branch).toBe("flag-branch");
    expect(capturedFetch?.remoteUrl).toBe("https://x-access-token:gh-token@github.com/flag/head.git");
    expect(capturedPost).toMatchObject({ baseRepo: "flag/base", pr: "9", token: "gh-token" });
  });

  it("returns missing-notice when no ref or prior marker exists", async () => {
    const { ctx, out } = fakeContext(["pr-check"], {
      GITHUB_REPOSITORY: "owner/repo",
      GITHUB_EVENT_PATH: eventFile("owner/repo", "branch"),
      GITHUB_TOKEN: "tok",
    });

    const exit = await runPrCheck(ctx, {
      makeTempRepo: tempRepoDeps().makeTempRepo,
      fetchAndRender: () => ({ code: 2, message: "no ref" }),
      findMarker: async () => null,
    });

    expect(exit).toBe(0);
    expect(out()).toBe("missing-notice\n");
  });

  it("returns missing-required for enforced same-repo PRs", async () => {
    const { ctx, out, err } = fakeContext(["pr-check", "--require-same-repo"], {
      GITHUB_REPOSITORY: "owner/repo",
      GITHUB_EVENT_PATH: eventFile("owner/repo", "branch"),
      GITHUB_TOKEN: "tok",
    });

    const exit = await runPrCheck(ctx, {
      makeTempRepo: tempRepoDeps().makeTempRepo,
      fetchAndRender: () => ({ code: 2, message: "no ref" }),
      findMarker: async () => null,
    });

    expect(exit).toBe(1);
    expect(out()).toBe("missing-required\n");
    expect(err()).toContain("pr --store ref --push-ref");
  });

  it("keeps a found fork receipt green when posting gets a read-only token", async () => {
    const { ctx, out, err } = fakeContext(["pr-check"], {
      GITHUB_REPOSITORY: "owner/repo",
      GITHUB_EVENT_PATH: eventFile("fork/repo", "branch"),
      GITHUB_TOKEN: "tok",
    });

    const exit = await runPrCheck(ctx, {
      makeTempRepo: tempRepoDeps().makeTempRepo,
      fetchAndRender: () => foundBody(),
      upsertMarker: async () => ({ ok: false, readOnly: true, reason: "read-only token (fork PR)" }),
      findMarker: async () => null,
    });

    expect(exit).toBe(0);
    expect(out()).toBe("found\n");
    expect(err()).toContain("read-only token");
  });

  it("passes the same sanitized body as fetchAndRenderReceipt/renderPrBody", async () => {
    let postedBody = "";
    const payload: PrReceiptPayload = {
      schemaVersion: PR_RECEIPT_SCHEMA_VERSION,
      bodyInput: { contributors: [], excludedCount: 0 },
      extras: {
        details: [{ label: "[x](javascript:alert(1))", row: [], text: "```hostile```" }],
        artifactLink: { fileName: "p.html", url: "javascript:alert(1)" },
      },
    };
    const json = serializePrReceipt(payload);
    const rendered = renderReceiptPayload(json);
    if (!rendered.ok) {
      throw new Error(rendered.reason);
    }
    const sanitized = sanitizePrReceiptPayload(payload);
    const expected = renderPrBody(sanitized.bodyInput, sanitized.extras);
    const { ctx } = fakeContext(["pr-check"], {
      GITHUB_REPOSITORY: "owner/repo",
      GITHUB_EVENT_PATH: eventFile("owner/repo", "branch"),
      GITHUB_TOKEN: "tok",
    });

    const exit = await runPrCheck(ctx, {
      makeTempRepo: tempRepoDeps().makeTempRepo,
      fetchAndRender: (args) => fetchAndRenderReceipt(args, { fetchRef: () => true, readRef: () => json }),
      upsertMarker: async (args) => {
        postedBody = args.body;
        return { ok: true, action: "created" };
      },
      findMarker: async () => null,
    });

    expect(exit).toBe(0);
    expect(postedBody).toBe(rendered.body);
    expect(postedBody).toBe(expected);
    expect(postedBody).not.toMatch(/\]\(\s*javascript:/i);
  });

  it("does not pull the PNG rasterizer into the pr-check module path", () => {
    const source = readFileSync(path.join(ROOT, "src/cli/commands/pr-check.ts"), "utf8");
    const renderSource = readFileSync(path.join(ROOT, "src/pr/postRef.ts"), "utf8");
    expect(source).not.toContain("@resvg/resvg-js");
    expect(source).not.toContain("../../receipt/png");
    expect(renderSource).not.toContain("@resvg/resvg-js");
  });

  it("defaultTempRepo initializes a real git repo and cleanup removes it", () => {
    const temp = defaultTempRepo();
    try {
      expect(statSync(temp.cwd).isDirectory()).toBe(true);
      expect(existsSync(path.join(temp.cwd, ".git"))).toBe(true);
    } finally {
      temp.cleanup();
    }
    expect(existsSync(temp.cwd)).toBe(false);
  });

  it("runs the real temp repo end-to-end (git init + injected fetch) and posts (R2 matrix)", async () => {
    const payload: PrReceiptPayload = {
      schemaVersion: PR_RECEIPT_SCHEMA_VERSION,
      bodyInput: { contributors: [], excludedCount: 0 },
      extras: { details: [] },
    };
    const json = serializePrReceipt(payload);
    const rendered = renderReceiptPayload(json);
    if (!rendered.ok) {
      throw new Error(rendered.reason);
    }
    let postedBody = "";
    const { ctx, out } = fakeContext(["pr-check"], {
      GITHUB_REPOSITORY: "owner/repo",
      GITHUB_EVENT_PATH: eventFile("owner/repo", "branch"),
      GITHUB_TOKEN: "tok",
    });

    // No makeTempRepo / fetchAndRender injected → the real defaultTempRepo (`git init`) and
    // the real fetchAndRenderReceipt run; only the ref fetch/read and REST post are stubbed.
    const exit = await runPrCheck(ctx, {
      fetchRef: () => true,
      readRef: () => json,
      upsertMarker: async (args) => {
        postedBody = args.body;
        return { ok: true, action: "created" };
      },
      findMarker: async () => null,
    });

    expect(exit).toBe(0);
    expect(out()).toBe("found\n");
    expect(postedBody).toBe(rendered.body);
  });

  it("returns exit 1 when the temp repo cannot be created", async () => {
    const { ctx, err } = fakeContext(["pr-check"], {
      GITHUB_REPOSITORY: "owner/repo",
      GITHUB_EVENT_PATH: eventFile("owner/repo", "branch"),
      GITHUB_TOKEN: "tok",
    });

    const exit = await runPrCheck(ctx, {
      makeTempRepo: () => {
        throw new Error("git init failed");
      },
      fetchAndRender: () => foundBody(),
    });

    expect(exit).toBe(1);
    expect(err()).toContain("could not initialize temp git repo");
  });

  it("treats an existing marker comment without a ref as found", async () => {
    const { ctx, out } = fakeContext(["pr-check"], {
      GITHUB_REPOSITORY: "owner/repo",
      GITHUB_EVENT_PATH: eventFile("owner/repo", "branch"),
      GITHUB_TOKEN: "tok",
    });

    const exit = await runPrCheck(ctx, {
      makeTempRepo: tempRepoDeps().makeTempRepo,
      fetchAndRender: () => ({ code: 2, message: "no ref" }),
      findMarker: async () => ({ id: 55 }),
    });

    expect(exit).toBe(0);
    expect(out()).toBe("found\n");
  });
});
