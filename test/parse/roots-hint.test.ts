import { describe, expect, it, vi } from "vitest";

vi.mock("../../src/parse/registry.js", () => ({
  adapterFor: () => undefined,
  adapters: () => [
    { roots: () => ["/one", "/two"] },
    { roots: () => ["/two", "/three", ""] },
  ],
  detectedAdapters: async () => [],
}));

import { rootsHint } from "../../src/parse/load.js";

describe("SPEC-0082 root diagnostics", () => {
  it("lists every searched root once in adapter order", () => {
    expect(rootsHint()).toBe("/one, /two, /three");
  });
});
