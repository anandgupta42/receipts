import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { INSTALL_FOOTER_TEXT, PR_ATTRIBUTION_LINE, REPOSITORY_DISPLAY, REPOSITORY_URL } from "../../src/receipt/branding.js";

describe("SPEC-0078 R2 canonical receipt identity", () => {
  it("normalizes package metadata to the one repository URL used by receipt surfaces", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { repository: { url: string } };
    const normalized = new URL(pkg.repository.url.replace(/^git\+/, "").replace(/\.git$/, "")).href.replace(/\/$/, "");
    expect(normalized).toBe(REPOSITORY_URL);
    expect(REPOSITORY_DISPLAY).toBe("github.com/anandgupta42/receipts");
    expect(INSTALL_FOOTER_TEXT).toBe("npx aireceipts-cli");
    expect(PR_ATTRIBUTION_LINE).toContain(REPOSITORY_URL);
  });
});
