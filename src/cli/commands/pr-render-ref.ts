// SPEC-0066 R1/R3 — the CI render entrypoint (NO write token). Two modes:
//   `pr-render-ref <branch> <head-repo-url>` — fetch the branch's receipt ref from the PR
//       head repo, validate + sanitize, print the comment body (the CI path).
//   `pr-render-ref`  (no args) — read a payload JSON on stdin and render it (local/debug).
// Hidden (no help entry): the reusable workflow invokes it as
// `npx aireceipts-cli@latest pr-render-ref <branch> <url>`, then posts the sanitized body
// in a separate audited step with the token. Invalid/hostile input exits non-zero with
// nothing on stdout (CI treats that as "no receipt"). Generation stays local (I1/I4).
import { fetchReceiptRef, readReceiptRef } from "../../pr/store.js";
import { fetchAndRenderReceipt, renderReceiptPayload } from "../../pr/postRef.js";
import { readStdin } from "./statusline.js";
import type { CommandContext, CommandDef } from "../types.js";

async function run(ctx: CommandContext): Promise<number> {
  const [, branch, remoteUrl] = ctx.options.positional;
  if (branch && remoteUrl) {
    const out = fetchAndRenderReceipt(
      { branch, remoteUrl, cwd: ctx.cwd() },
      { fetchRef: fetchReceiptRef, readRef: readReceiptRef },
    );
    if (out.code !== 0) {
      ctx.stderr.write(`pr-render-ref: ${out.message}\n`);
      return out.code;
    }
    ctx.stdout.write(`${out.body}\n`);
    return 0;
  }

  const rendered = renderReceiptPayload(await readStdin(ctx.stdin));
  if (!rendered.ok) {
    ctx.stderr.write(`pr-render-ref: invalid receipt payload — ${rendered.reason}\n`);
    return 1;
  }
  ctx.stdout.write(`${rendered.body}\n`);
  return 0;
}

export const command: CommandDef = {
  name: "pr-render-ref",
  priority: 60,
  matches: (options) => options.positional[0] === "pr-render-ref",
  run,
};
