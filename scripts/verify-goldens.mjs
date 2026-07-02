// CI gate: byte-verifies golden receipts (delegates to goldens.mts under a frozen env).
import { spawnSync } from "node:child_process";
const r = spawnSync("npx", ["tsx", "scripts/goldens.mts", ...process.argv.slice(2)], {
  stdio: "inherit",
  env: { ...process.env, NO_COLOR: "1", TZ: "UTC", LANG: "C" },
});
process.exit(r.status ?? 1);
