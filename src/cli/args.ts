// SPEC-0018: command selection moved into the registry (registry.ts) and flag
// parsing into options.ts — the `parseArgs` selection funnel that every new
// command used to edit is gone. This module remains only as the stable import
// surface for `resolveCommand`, the R8 preservation seam, so its callers (and the
// committed preservation suite) don't move when the implementation changes.
export { resolveCommand } from "./registry.js";
