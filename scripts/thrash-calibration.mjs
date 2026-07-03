// Maintainer gate: labeled clean-corpus precision check for context-thrash
// (SPEC-0017 kill criterion, issue #46). Compile-to-temp like verify-goldens
// so this never depends on `npx` fetching tsx or on a stale dist/.
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

function tsFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return tsFiles(path);
    return entry.isFile() && path.endsWith(".ts") ? [path] : [];
  });
}

const root = process.cwd();
const tmp = mkdtempSync(join(tmpdir(), "aireceipts-thrash-cal-"));
const outDir = join(tmp, "out");
const configPath = join(tmp, "tsconfig.thrash-cal.json");
const tscPath = join(root, "node_modules", "typescript", "bin", "tsc");
const files = [join(root, "scripts", "thrash-calibration.mts"), ...tsFiles(join(root, "src"))];

writeFileSync(
  configPath,
  JSON.stringify(
    {
      compilerOptions: {
        target: "ES2022",
        module: "NodeNext",
        moduleResolution: "NodeNext",
        lib: ["ES2022"],
        strict: true,
        esModuleInterop: true,
        skipLibCheck: true,
        resolveJsonModule: true,
        rootDir: root,
        outDir,
      },
      files,
    },
    null,
    2,
  ),
);

let status = 1;
try {
  const compile = spawnSync(process.execPath, [tscPath, "--project", configPath], {
    stdio: "inherit",
    env: { ...process.env, NO_COLOR: "1", TZ: "UTC", LANG: "C" },
  });
  // A compile failure is a tooling error (exit 1) — tsc's own status 2 must not
  // masquerade as the gate's "evidence insufficient" exit code.
  status = compile.status === 0 ? 0 : 1;

  if (status === 0) {
    cpSync(join(root, "data"), join(outDir, "data"), { recursive: true });
    const script = join(outDir, relative(root, join(root, "scripts", "thrash-calibration.mts"))).replace(
      /\.mts$/u,
      ".mjs",
    );
    const run = spawnSync(process.execPath, [script, ...process.argv.slice(2)], {
      stdio: "inherit",
      env: { ...process.env, NO_COLOR: "1", TZ: "UTC", LANG: "C" },
    });
    status = run.status ?? 1;
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

process.exit(status);
