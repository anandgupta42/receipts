// CI gate: byte-verifies golden receipts under a frozen env.
// Compile to a temp dir first so this gate never depends on `npx` fetching tsx.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

const root = process.cwd();
const cacheRoot = join(root, "node_modules", ".cache", "aireceipts-goldens");
const tscPath = join(root, "node_modules", "typescript", "bin", "tsc");
const frozenEnv = { ...process.env, NO_COLOR: "1", TZ: "UTC", LANG: "C" };
const compilerOptions = {
  target: "ES2022",
  module: "NodeNext",
  moduleResolution: "NodeNext",
  lib: ["ES2022"],
  strict: true,
  esModuleInterop: true,
  skipLibCheck: true,
  resolveJsonModule: true,
  rootDir: root,
  outDir: "out",
};

let sourceRelFilesCache;
let dataRelFilesCache;

function filesUnder(relDir, predicate) {
  const absDir = join(root, relDir);
  return readdirSync(absDir, { withFileTypes: true })
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    .flatMap((entry) => {
      const relPath = join(relDir, entry.name);
      if (entry.isDirectory()) return filesUnder(relPath, predicate);
      return entry.isFile() && predicate(relPath) ? [relPath] : [];
    });
}

function sourceRelFiles() {
  sourceRelFilesCache ??= ["scripts/goldens.mts", ...filesUnder("src", (path) => path.endsWith(".ts"))].sort();
  return sourceRelFilesCache;
}

function dataRelFiles() {
  dataRelFilesCache ??= filesUnder("data", () => true).sort();
  return dataRelFilesCache;
}

function buildConfig(configPath) {
  writeFileSync(
    configPath,
    JSON.stringify(
      {
        compilerOptions,
        files: sourceRelFiles().map((p) => join(root, p)),
      },
      null,
      2,
    ),
  );
}

function hashString(hash, label, value) {
  hash.update(`${label}\0${value}\0`);
}

function hashPathList(hash, label, paths) {
  hash.update(`${label}\0`);
  for (const path of paths) hash.update(`${path}\0`);
}

function hashFiles(hash, label, paths) {
  hash.update(`${label}\0`);
  for (const path of paths) {
    hash.update(`${path}\0`);
    hash.update(readFileSync(join(root, path)));
    hash.update("\0");
  }
}

function cacheKey() {
  const tsVersion = JSON.parse(readFileSync(join(root, "node_modules", "typescript", "package.json"), "utf8")).version;
  const packageType = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).type ?? "";
  const hash = createHash("sha256");
  hashString(hash, "compilerOptions", JSON.stringify(compilerOptions));
  hashString(hash, "typescriptVersion", tsVersion);
  hashString(hash, "packageType", packageType);
  hashPathList(hash, "sourcePaths", sourceRelFiles());
  hashFiles(hash, "sourceFiles", sourceRelFiles());
  hashPathList(hash, "dataPaths", dataRelFiles());
  hashFiles(hash, "dataFiles", dataRelFiles());
  return hash.digest("hex");
}

function compiledScript(outDir) {
  return join(outDir, relative(root, join(root, "scripts", "goldens.mts"))).replace(/\.mts$/u, ".mjs");
}

function compileInto(tempDir) {
  const outDir = join(tempDir, "out");
  const configPath = join(tempDir, "tsconfig.goldens.json");
  buildConfig(configPath);
  const compile = spawnSync(process.execPath, [tscPath, "--project", configPath], {
    stdio: "inherit",
    env: frozenEnv,
  });
  const status = compile.status ?? 1;
  if (status !== 0) return status;
  cpSync(join(root, "data"), join(outDir, "data"), { recursive: true });
  return 0;
}

function runGoldens(outDir) {
  const verify = spawnSync(process.execPath, [compiledScript(outDir), ...process.argv.slice(2)], {
    stdio: "inherit",
    env: frozenEnv,
  });
  return verify.status ?? 1;
}

function runFresh() {
  const tmp = mkdtempSync(join(tmpdir(), "aireceipts-goldens-"));
  try {
    const status = compileInto(tmp);
    return status === 0 ? runGoldens(join(tmp, "out")) : status;
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

function isComplete(entryDir) {
  // Sentinel plus the compiled entrypoint: a corrupt entry (sentinel present,
  // output missing) must read as a miss so the run falls back to compiling.
  return existsSync(join(entryDir, ".complete")) && existsSync(compiledScript(join(entryDir, "out")));
}

function isRenameRace(error) {
  return error && typeof error === "object" && "code" in error && ["EEXIST", "ENOTEMPTY", "EPERM"].includes(String(error.code));
}

function pruneCache(currentHash) {
  const now = Date.now();
  const entryTtlMs = 7 * 24 * 60 * 60 * 1000;
  const tmpTtlMs = 24 * 60 * 60 * 1000;
  try {
    for (const entry of readdirSync(cacheRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const path = join(cacheRoot, entry.name);
      const ageMs = now - statSync(path).mtimeMs;
      if (entry.name.startsWith(".tmp-")) {
        if (ageMs > tmpTtlMs) rmSync(path, { recursive: true, force: true });
      } else if (entry.name !== currentHash && ageMs > entryTtlMs) {
        rmSync(path, { recursive: true, force: true });
      }
    }
  } catch {
    // Best-effort pruning must never affect verification.
  }
}

function runWithCache() {
  const key = cacheKey();
  mkdirSync(cacheRoot, { recursive: true });
  pruneCache(key);

  const entryDir = join(cacheRoot, key);
  if (isComplete(entryDir)) return runGoldens(join(entryDir, "out"));

  const tempDir = mkdtempSync(join(cacheRoot, `.tmp-${process.pid}-`));
  let removeTemp = true;
  try {
    const status = compileInto(tempDir);
    if (status !== 0) return status;

    writeFileSync(join(tempDir, ".complete"), "");
    try {
      renameSync(tempDir, entryDir);
      removeTemp = false;
      return runGoldens(join(entryDir, "out"));
    } catch (error) {
      if (!isRenameRace(error)) throw error;
      if (isComplete(entryDir)) return runGoldens(join(entryDir, "out"));
      // An incomplete entry can never be live (rename is atomic and happens
      // after the sentinel is written) — it is corrupt. Evict it so the next
      // run gets a clean hit instead of recompiling forever.
      try {
        rmSync(entryDir, { recursive: true, force: true });
        renameSync(tempDir, entryDir);
        removeTemp = false;
        return runGoldens(join(entryDir, "out"));
      } catch {
        return runGoldens(join(tempDir, "out"));
      }
    }
  } finally {
    if (removeTemp) rmSync(tempDir, { recursive: true, force: true });
  }
}

let status = 1;
try {
  status = runWithCache();
} catch {
  status = runFresh();
}

process.exit(status);
