// The pre-release preflight's publish-shape contract. The heavy checks (build,
// pack, install-run, full suite, goldens) run when the script executes in the
// release flow; here we pin the pure guards that decide RELEASABLE vs not.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { checkManifest, checkTarball, MAX_TARBALL_FILES, MAX_UNPACKED_KB } from "../scripts/preflight-release.mjs";

const realPkg = JSON.parse(readFileSync("package.json", "utf8"));
const realLock = JSON.parse(readFileSync("package-lock.json", "utf8"));
const REQ = ["dist/cli.js", "README.md", "LICENSE", "NOTICE", "data/prices/anthropic.json"];

describe("preflight · checkManifest", () => {
  it("passes on the real manifest + lockfile", () => {
    expect(checkManifest(realPkg, realLock)).toEqual([]);
  });

  it("rejects the blocked unscoped name", () => {
    expect(checkManifest({ ...realPkg, name: "aireceipts" }, null).some((m) => m.includes("aireceipts-cli"))).toBe(true);
  });

  it("rejects a moved bin (the typed command must stay `aireceipts`)", () => {
    expect(checkManifest({ ...realPkg, bin: { "aireceipts-cli": "dist/cli.js" } }, null).some((m) => m.includes("bin.aireceipts"))).toBe(true);
  });

  it("rejects private:true", () => {
    expect(checkManifest({ ...realPkg, private: true }, null).some((m) => m.includes("private"))).toBe(true);
  });

  it("rejects a files allowlist missing data/prices (runtime-required)", () => {
    expect(checkManifest({ ...realPkg, files: ["dist", "README.md", "LICENSE"] }, null).some((m) => m.includes("files"))).toBe(true);
  });

  it("rejects a LEAKED files entry (exact allowlist, not just superset)", () => {
    expect(checkManifest({ ...realPkg, files: [...realPkg.files, "src"] }, null).some((m) => m.includes("files"))).toBe(true);
  });

  it("rejects prepublishOnly diverging from build (publish builds via prepublishOnly)", () => {
    const pkg = { ...realPkg, scripts: { ...realPkg.scripts, prepublishOnly: "echo stale" } };
    expect(checkManifest(pkg, null).some((m) => m.includes("prepublishOnly"))).toBe(true);
  });

  it("rejects a wrong host/owner even with the right repo suffix", () => {
    const pkg = { ...realPkg, repository: { type: "git", url: "git+https://evil.example/attacker/receipts.git" } };
    expect(checkManifest(pkg, null).some((m) => m.includes("repository"))).toBe(true);
  });

  it("rejects a prepack/prepare hook that would alter the tarball unseen", () => {
    const withPrepack = { ...realPkg, scripts: { ...realPkg.scripts, prepack: "node evil.js" } };
    expect(checkManifest(withPrepack, null).some((m) => m.includes("prepack"))).toBe(true);
    const withPrepare = { ...realPkg, scripts: { ...realPkg.scripts, prepare: "node evil.js" } };
    expect(checkManifest(withPrepare, null).some((m) => m.includes("prepare"))).toBe(true);
  });

  it("rejects a name/version drift between manifest and lockfile", () => {
    expect(checkManifest(realPkg, { ...realLock, version: "9.9.9" }).some((m) => m.includes("version"))).toBe(true);
    expect(checkManifest(realPkg, { ...realLock, name: "other" }).some((m) => m.includes("name"))).toBe(true);
  });
});

describe("preflight · checkTarball", () => {
  const good = {
    files: [{ path: "dist/cli.js" }, { path: "data/prices/anthropic.json" }, { path: "README.md" }, { path: "LICENSE" }, { path: "NOTICE" }],
    unpackedSize: 294 * 1024,
  };

  it("passes a lean, complete tarball", () => {
    expect(checkTarball(good, REQ)).toEqual([]);
  });

  it("rejects a missing runtime file", () => {
    const v = checkTarball({ ...good, files: good.files.filter((f) => f.path !== "data/prices/anthropic.json") }, REQ);
    expect(v.some((m) => m.includes("data/prices/anthropic.json"))).toBe(true);
  });

  it("rejects shipped sourcemaps", () => {
    expect(checkTarball({ ...good, files: [...good.files, { path: "dist/cli.js.map" }] }, REQ).some((m) => m.includes("sourcemap"))).toBe(true);
  });

  it("rejects a bloated file count", () => {
    const files = Array.from({ length: MAX_TARBALL_FILES + 1 }, (_, i) => ({ path: `dist/x${i}.js` }));
    expect(checkTarball({ ...good, files: [...good.files, ...files] }, REQ).some((m) => m.includes("files"))).toBe(true);
  });

  it("rejects an oversized unpacked payload", () => {
    expect(checkTarball({ ...good, unpackedSize: (MAX_UNPACKED_KB + 1) * 1024 }, REQ).some((m) => m.includes("KB"))).toBe(true);
  });
});
