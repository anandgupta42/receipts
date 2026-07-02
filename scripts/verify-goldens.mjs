// CI gate: byte-verifies golden receipts under a frozen env.
// Compile to a temp dir first so this gate never depends on `npx` fetching tsx.
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
const tmp = mkdtempSync(join(tmpdir(), "aireceipts-goldens-"));
const outDir = join(tmp, "out");
const configPath = join(tmp, "tsconfig.goldens.json");
const tscPath = join(root, "node_modules", "typescript", "bin", "tsc");
const files = [join(root, "scripts", "goldens.mts"), ...tsFiles(join(root, "src"))];

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
  status = compile.status ?? 1;

  if (status === 0) {
    cpSync(join(root, "data"), join(outDir, "data"), { recursive: true });
    const script = join(outDir, relative(root, join(root, "scripts", "goldens.mts"))).replace(/\.mts$/u, ".mjs");
    const verify = spawnSync(process.execPath, [script, ...process.argv.slice(2)], {
      stdio: "inherit",
      env: { ...process.env, NO_COLOR: "1", TZ: "UTC", LANG: "C" },
    });
    status = verify.status ?? 1;
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

process.exit(status);
