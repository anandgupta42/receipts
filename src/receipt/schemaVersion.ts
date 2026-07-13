// SPEC-0011 R4: the export-schema version constant, in a dependency-free module.
// It lives apart from `exportSchema.ts` (which re-exports it) so that renderers
// emitting a `schemaVersion` envelope can import the number without pulling zod
// into their runtime graph — the goldens verifier runs the compiled `src/` tree
// from a bare temp dir where zod is unresolvable, and `src/index.ts`'s barrel
// must stay loadable there.

/** Bumped only on a breaking `--json` shape change (R4). Mirrored in `docs/json-schema.md`. */
export const SCHEMA_VERSION = 2;
