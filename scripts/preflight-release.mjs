#!/usr/bin/env node
// Pre-release preflight: the one command that answers "is THIS SHA safe to
// publish to npm." It runs the SAME gates CI runs (so a green preflight needs
// no separate CI trust) PLUS what CI never gates on the release SHA: the
// packaged, installed, running artifact and the publish-shape manifest.
// release-publish.yml runs this before `npm publish` (and CI runs `--quick`
// on every PR), so a red SHA cannot ship through the workflow.
//
//   node scripts/preflight-release.mjs            # full gate (release-valid)
//   node scripts/preflight-release.mjs --quick    # fast subset, NOT release-valid
//
// Note: on CI it runs the full vitest suite; on a LOCAL run it sets
// AIRECEIPTS_SKIP_STRESS=1 to skip the one spawn-heavy 100-session e2e stress
// case, which throttles badly on dev macOS under the full suite. CI (including
// release-publish's own preflight, CI=true) runs everything, and CI-green-on-SHA
// is a hard release precondition — so the release gate keeps full coverage.
import { execFile } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const r = (p) => join(ROOT, p);

// Ceilings: the lean tarball is ~48 files / ~294 KB. Headroom so a real
// regression (sourcemaps back, a stray dir) trips it, not normal growth.
export const MAX_TARBALL_FILES = 80;
export const MAX_UNPACKED_KB = 500;
// NOTICE ships because Apache-2.0 §4(d) requires redistributions to include it.
export const FILES_ALLOWLIST = ["dist", "data/prices", "data/demo", "README.md", "LICENSE", "NOTICE"];

/** Committed price tables (the runtime needs every one) → their tarball paths. */
function priceTablePaths() {
  return readdirSync(r("data/prices"))
    .filter((f) => f.endsWith(".json"))
    .map((f) => `data/prices/${f}`);
}

/** The bundled demo transcript (SPEC-0051 `--demo` reads it) → its tarball path(s). */
function demoAssetPaths() {
  return readdirSync(r("data/demo"))
    .filter((f) => f.endsWith(".jsonl"))
    .map((f) => `data/demo/${f}`);
}

/**
 * Pure manifest check — the publish-shape contract, unit-testable without a build.
 * Returns a list of human-readable violations ([] = clean).
 */
export function checkManifest(pkg, lock) {
  const v = [];
  if (pkg.name !== "aireceipts-cli") v.push(`name must be "aireceipts-cli" (unscoped "aireceipts" is blocked by npm), got "${pkg.name}"`);
  if (pkg.bin?.aireceipts !== "dist/cli.js") v.push(`bin.aireceipts must be "dist/cli.js" (the typed command stays "aireceipts"), got "${pkg.bin?.aireceipts}"`);
  if (Object.keys(pkg.bin ?? {}).length !== 1) v.push(`bin must have exactly one entry ("aireceipts")`);
  if (pkg.private !== false) v.push(`"private" must be false to publish, got ${JSON.stringify(pkg.private)}`);
  // Exact allowlist: a LEAKED entry (src, tests) is as bad as a missing one.
  const files = [...(pkg.files ?? [])].sort();
  const want = [...FILES_ALLOWLIST].sort();
  if (files.length !== want.length || files.some((f, i) => f !== want[i])) {
    v.push(`files must be exactly ${JSON.stringify(want)}, got ${JSON.stringify(files)}`);
  }
  // publish runs prepublishOnly, not build — they must be the same builder, or
  // the pack we validate here isn't what npm publish would ship.
  if (pkg.scripts?.prepublishOnly !== pkg.scripts?.build) {
    v.push(`scripts.prepublishOnly (${pkg.scripts?.prepublishOnly}) must equal scripts.build (${pkg.scripts?.build}) — publish builds via prepublishOnly`);
  }
  // prepack/prepare run during `npm publish`'s pack lifecycle but NOT during the
  // `--ignore-scripts` pack this preflight validates — so they could alter the
  // shipped tarball behind our back. Ban them; prepublishOnly is the builder.
  for (const hook of ["prepack", "prepare"]) {
    if (pkg.scripts?.[hook] !== undefined) v.push(`scripts.${hook} would alter the published tarball unseen by preflight — remove it (build via prepublishOnly)`);
  }
  // Exact host/owner/repo — a wrong host or owner must NOT pass on a suffix.
  const repoPath = (pkg.repository?.url ?? "").replace(/^git\+/, "").replace(/^https?:\/\//, "").replace(/\.git$/, "");
  if (repoPath !== "github.com/anandgupta42/receipts") {
    v.push(`repository.url must be github.com/anandgupta42/receipts (provenance + publish-workflow assertion), got "${pkg.repository?.url}"`);
  }
  if (!pkg.homepage) v.push(`homepage missing (npm page + provenance)`);
  if (!pkg.bugs?.url) v.push(`bugs.url missing`);
  if (!/\d/.test(pkg.engines?.node ?? "")) v.push(`engines.node must pin a version, got "${pkg.engines?.node}"`);
  if (lock && lock.name !== pkg.name) v.push(`package-lock name "${lock.name}" != package.json name "${pkg.name}" (run npm install)`);
  if (lock && lock.version !== pkg.version) v.push(`package-lock version "${lock.version}" != package.json version "${pkg.version}"`);
  return v;
}

/** Assert the tarball npm WOULD publish is lean and complete. Returns violations. */
export function checkTarball(manifest, requiredPaths) {
  const v = [];
  const paths = manifest.files.map((f) => f.path);
  for (const req of requiredPaths) {
    if (!paths.includes(req)) v.push(`tarball missing required file: ${req}`);
  }
  const maps = paths.filter((p) => p.endsWith(".map"));
  if (maps.length) v.push(`tarball ships ${maps.length} sourcemap(s) — set sourcemap:false in tsup.config.ts`);
  if (manifest.files.length > MAX_TARBALL_FILES) v.push(`tarball has ${manifest.files.length} files (> ${MAX_TARBALL_FILES}) — something bloated the package`);
  const unpackedKb = manifest.unpackedSize / 1024;
  if (unpackedKb > MAX_UNPACKED_KB) v.push(`tarball unpacked ${unpackedKb.toFixed(0)} KB (> ${MAX_UNPACKED_KB} KB)`);
  return v;
}

const execFileAsync = promisify(execFile);
const MAX_EXEC_BUFFER = 64 * 1024 * 1024;

async function sh(cmd, args, opts = {}) {
  const { stdout } = await execFileAsync(cmd, args, { cwd: ROOT, encoding: "utf8", maxBuffer: MAX_EXEC_BUFFER, ...opts });
  return stdout;
}

function failureMessage(error) {
  const stdout = typeof error?.stdout === "string" ? error.stdout : "";
  const stderr = typeof error?.stderr === "string" ? error.stderr : "";
  const message = error instanceof Error ? error.message : String(error);
  const out = (stdout + stderr).trim() || message;
  return String(out).split("\n").slice(-20).join("\n");
}

async function record(results, name, fn) {
  try {
    await fn();
    const result = { name, ok: true };
    results.set(name, result);
    console.log(`✓ ${name}`);
    return result;
  } catch (error) {
    const result = { name, ok: false, msg: failureMessage(error) };
    results.set(name, result);
    console.log(`✗ ${name}`);
    return result;
  }
}

function recordSkipped(results, name, msg) {
  const result = { name, ok: false, msg };
  results.set(name, result);
  console.log(`✗ ${name}`);
  return result;
}

async function main() {
  const quick = process.argv.includes("--quick");
  const results = new Map();
  const gateOrder = [
    "manifest: publish-shape contract",
    "build → dist/cli.js + shebang",
    "tarball: lean + complete",
    "tsc --noEmit",
    "eslint --max-warnings 0",
    "cite-check (all price tables, liveness enforced)",
    "verify-goldens",
    "spec-lint",
    "hygiene",
    "vitest run (full suite, incl. install+run e2e)",
    "determinism-check ×10",
  ];

  await record(results, "manifest: publish-shape contract", () => {
    const pkg = JSON.parse(readFileSync(r("package.json"), "utf8"));
    const lock = existsSync(r("package-lock.json")) ? JSON.parse(readFileSync(r("package-lock.json"), "utf8")) : null;
    const viol = checkManifest(pkg, lock);
    if (viol.length) throw new Error(viol.join("\n"));
  });

  // Build and pack are the only dist/ writer/readers besides the vitest e2e
  // beforeAll rebuild, so they complete before anything else starts; after this
  // point only vitest touches dist/.
  await record(results, "build → dist/cli.js + shebang", async () => {
    await sh("npm", ["run", "build"]);
    if (!existsSync(r("dist/cli.js"))) throw new Error("dist/cli.js missing after build");
    const first = readFileSync(r("dist/cli.js"), "utf8").split("\n", 1)[0];
    if (first !== "#!/usr/bin/env node") throw new Error(`dist/cli.js first line is not a node shebang: ${first}`);
  });

  await record(results, "tarball: lean + complete", async () => {
    const out = await sh("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"]);
    const viol = checkTarball(JSON.parse(out)[0], ["dist/cli.js", "README.md", "LICENSE", "NOTICE", ...priceTablePaths(), ...demoAssetPaths()]);
    if (viol.length) throw new Error(viol.join("\n"));
  });

  const stressEnv = process.env.CI ? {} : { AIRECEIPTS_SKIP_STRESS: "1" };
  const concurrent = [
    record(results, "tsc --noEmit", () => sh("npx", ["tsc", "--noEmit"])),
    record(results, "eslint --max-warnings 0", () => sh("npx", ["eslint", ".", "--max-warnings", "0"])),
    record(results, "cite-check (all price tables, liveness enforced)", () =>
      sh("node", ["--experimental-strip-types", "scripts/cite-check.ts", ...priceTablePaths()], { env: { ...process.env, CI: "1" } }),
    ),
    record(results, "spec-lint", () => sh("node", ["scripts/spec-lint.mjs"])),
    record(results, "hygiene", () => sh("node", ["scripts/hygiene.mjs"])),
  ];
  const verify = record(results, "verify-goldens", () => sh("node", ["scripts/verify-goldens.mjs"]));
  concurrent.push(verify);

  if (!quick) {
    concurrent.push(
      record(results, "vitest run (full suite, incl. install+run e2e)", () =>
        sh("npx", ["vitest", "run"], { env: { ...process.env, ...stressEnv } })),
    );
    concurrent.push(
      verify.then((result) => {
        if (!result.ok) return recordSkipped(results, "determinism-check ×10", "skipped: verify-goldens failed");
        return record(results, "determinism-check ×10", () =>
          sh("node", ["scripts/determinism-check.mjs", "--runs=10", "--", "node", "scripts/verify-goldens.mjs"]));
      }),
    );
  }

  await Promise.all(concurrent);

  const orderedResults = gateOrder.map((name) => results.get(name)).filter(Boolean);
  const failed = orderedResults.filter((x) => !x.ok);
  console.log();
  if (failed.length) {
    console.error(`preflight: NOT RELEASABLE — ${failed.length} check(s) failed:`);
    for (const f of failed) console.error(`\n  ✗ ${f.name}\n${f.msg.split("\n").map((l) => `      ${l}`).join("\n")}`);
    process.exit(1);
  }
  if (quick) {
    console.log(`preflight: ${orderedResults.length} quick checks passed — NOT release-valid (skipped full suite + determinism; run without --quick before releasing).`);
    return;
  }
  console.log(`preflight: RELEASE-READY — ${orderedResults.length} checks passed.`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
