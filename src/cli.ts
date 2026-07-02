#!/usr/bin/env node
// CLI entry point — delegates to `src/cli/index.ts` for argument parsing and
// command dispatch (R6, SPEC-0001).
import { main } from "./cli/index.js";

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err) => {
    process.stderr.write(`${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
    process.exitCode = 1;
  });
