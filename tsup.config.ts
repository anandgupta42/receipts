import { defineConfig } from "tsup";

// SPEC-0018 R1: the command modules are emitted as their own files under
// `dist/cli/commands/` (not inlined into the cli bundle) so the runtime registry
// can discover them by reading that directory in the installed package. The glob
// entry means adding a command file is picked up automatically — tsup.config.ts
// is never edited to register a command. `src/cli.ts` and `src/index.ts` still
// emit to `dist/cli.js` / `dist/index.js` (outbase is the shared `src/` root), so
// the `bin` path is unchanged.
export default defineConfig({
  entry: ["src/cli.ts", "src/index.ts", "src/cli/commands/*.ts"],
  format: ["esm"],
  target: "node20",
  platform: "node",
  clean: true,
  // No sourcemaps in the published artifact: they were 70% of the npm tarball
  // and nothing (tests run on src via vitest; the determinism check runs the
  // built cli.js) consumes them at runtime. A bundled end-user CLI ships JS only.
  sourcemap: false,
  dts: false,
  banner: {
    js: "#!/usr/bin/env node",
  },
});
