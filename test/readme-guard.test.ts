// SPEC-0029 R4 — the README guard: the launch page can never drift from the
// product. Receipts shown in README must be byte-identical to committed
// goldens (I5 extended to the marketing surface); the tagline is synced to
// package.json; structural budgets are caps, not floors (budget constants
// cite docs/internal/readme-evidence.md — the committed corpus note).
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { describe, expect, it } from "vitest";

const readme = readFileSync("README.md", "utf8");
const lines = readme.split("\n");

// Corpus-derived caps (see docs/internal/readme-evidence.md): winners median
// 240 lines, emoji median 0.5 (73% have ≤2).
const MAX_LINES = 260;
const MAX_EMOJI = 2;
const MAX_BADGES = 3;
const TAGLINE_MAX = 120;

/** The first bold paragraph is the tagline (never a line number — SPEC-0029 R1). */
function tagline(): string {
  const line = lines.find((l) => /^\*\*.+\*\*$/.test(l.trim()));
  expect(line, "README must open with a bold tagline paragraph").toBeDefined();
  return line!.trim().replace(/^\*\*|\*\*$/g, "");
}

/** Every fenced block that contains the receipt wordmark. */
function fencedReceipts(): string[] {
  const out: string[] = [];
  const re = /```(?:\w*)\n([\s\S]*?)```/g;
  for (let m = re.exec(readme); m !== null; m = re.exec(readme)) {
    if (m[1].includes("AIRECEIPTS")) {
      out.push(m[1].replace(/\n$/, ""));
    }
  }
  return out;
}

describe("SPEC-0029 · README guard", () => {
  it("R1: tagline is bold, <120 chars, and byte-identical to package.json description", () => {
    const t = tagline();
    expect(t.length).toBeLessThan(TAGLINE_MAX);
    const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { description: string };
    expect(t).toBe(pkg.description);
  });

  it("R1: at most 3 badges, directly under the tagline, no heading", () => {
    const tagIdx = lines.findIndex((l) => /^\*\*.+\*\*$/.test(l.trim()));
    const badgeLines = lines.slice(tagIdx + 1, tagIdx + 6).filter((l) => l.includes("badge") || l.includes("shields.io"));
    expect(badgeLines.length).toBeGreaterThan(0);
    expect(badgeLines.length).toBeLessThanOrEqual(MAX_BADGES);
    expect(lines[tagIdx + 1].trim() === "" || badgeLines.includes(lines[tagIdx + 1])).toBe(true);
  });

  it("R2: hero <picture> sources resolve to committed golden SVGs (light + dark)", () => {
    const srcs = [...readme.matchAll(/(?:srcset|src)="(goldens\/svg\/[^"]+)"/g)].map((m) => m[1]);
    expect(srcs.length).toBeGreaterThanOrEqual(2);
    for (const s of srcs) {
      expect(existsSync(s), `hero source missing on disk: ${s}`).toBe(true);
    }
    expect(srcs.some((s) => s.endsWith("-dark.svg"))).toBe(true);
    expect(srcs.some((s) => s.endsWith("-light.svg"))).toBe(true);
  });

  it("R2/R4: every fenced receipt is byte-identical to a committed golden (the README never lies)", () => {
    const goldens = readdirSync("goldens")
      .filter((f) => f.endsWith(".txt"))
      .map((f) => readFileSync(`goldens/${f}`, "utf8").replace(/\n$/, ""));
    const shown = fencedReceipts();
    expect(shown.length).toBeGreaterThanOrEqual(1);
    for (const receipt of shown) {
      expect(
        goldens.some((g) => g === receipt),
        "a fenced receipt in README does not byte-match any committed golden",
      ).toBe(true);
    }
  });

  it("R2 red path: a single mutated byte breaks parity (the guard actually guards)", () => {
    const goldens = readdirSync("goldens")
      .filter((f) => f.endsWith(".txt"))
      .map((f) => readFileSync(`goldens/${f}`, "utf8").replace(/\n$/, ""));
    const mutated = fencedReceipts()[0].replace("TOTAL", "T0TAL");
    expect(goldens.some((g) => g === mutated)).toBe(false);
  });

  it("R4: zero emoji — the wordmark image and drawn SVGs carry all visual identity (SPEC-0034 R5 fallback)", () => {
    const emoji = readme.match(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu) ?? [];
    // Exact identity, not a cap. History: the title 🧾 became the wordmark
    // image (#78), and the footer 🔺 was rejected by the maintainer ("not a
    // samosa") — SPEC-0034's recorded fallback made the footer text-only.
    // The intentional emoji set is now empty.
    expect(emoji).toEqual([]);
    expect(emoji.length).toBeLessThanOrEqual(MAX_EMOJI);
  });

  it("R4: length cap", () => {
    expect(lines.length).toBeLessThanOrEqual(MAX_LINES);
  });

  it("R4: trust and telemetry docs are linked", () => {
    expect(readme).toContain("docs/trust.md");
    expect(readme).toContain("docs/telemetry.md");
  });

  it("SPEC-0053 R1: the PR-receipt proof image is committed and linked to a live comment on this repo", () => {
    const wrapped =
      /<a href="(https:\/\/github\.com\/anandgupta42\/receipts\/pull\/\d+#issuecomment-\d+)">\s*<img [^>]*src="(docs\/assets\/pr-receipt-comment\.png)"/.exec(readme);
    expect(wrapped, "README must show the proof image wrapped in a PR-comment permalink").not.toBeNull();
    expect(existsSync(wrapped![2]), `proof image missing on disk: ${wrapped![2]}`).toBe(true);
    // The caption's "read it live" link must point at the same comment as the image wrapper.
    const permalinks = [...readme.matchAll(/href="(https:\/\/github\.com\/anandgupta42\/receipts\/pull\/\d+#issuecomment-\d+)"/g)].map((m) => m[1]);
    expect(permalinks.length).toBeGreaterThanOrEqual(2);
    expect(new Set(permalinks).size, "image wrapper and caption must link the same comment").toBe(1);
    // Placement: directly under the badges (inside the hero div), before the first prose paragraph.
    const badgeIdx = lines.findIndex((l) => l.trim().startsWith("[!["));
    const imgLine = lines.findIndex((l) => l.includes("pr-receipt-comment.png"));
    const proseIdx = lines.findIndex((l) => l.startsWith("**Why this exists.**"));
    expect(imgLine, "proof image must sit directly under the badges").toBeGreaterThan(badgeIdx);
    expect(imgLine - badgeIdx, "proof image must be the first thing after the badges").toBeLessThanOrEqual(3);
    expect(imgLine).toBeLessThan(proseIdx);
  });

  it("SPEC-0053 R3: the install section is exactly four numbered steps and step 1 names --demo", () => {
    const installAt = lines.findIndex((l) => l.trim().toLowerCase().startsWith("## install"));
    const nextH2 = lines.findIndex((l, i) => i > installAt && l.startsWith("## "));
    const section = lines.slice(installAt, nextH2);
    const stepIdx = section.reduce<number[]>((acc, l, i) => (/^\d+\. /.test(l.trim()) ? [...acc, i] : acc), []);
    expect(stepIdx.map((i) => section[i].trim().slice(0, 2))).toEqual(["1.", "2.", "3.", "4."]);
    const stepOne = section.slice(stepIdx[0], stepIdx[1]).join(" ");
    expect(stepOne).toContain("--demo");
    const stepTwo = section.slice(stepIdx[1], stepIdx[2]).join(" ");
    expect(stepTwo).toContain("setup");
    const stepThree = section.slice(stepIdx[2], stepIdx[3]).join(" ");
    expect(stepThree).toContain("install-hook");
    expect(stepThree).toContain("statusline");
    const stepFour = section.slice(stepIdx[3]).join(" ");
    expect(stepFour).toContain("pr --post");
    expect(stepFour, "the CI workflow verifies receipts; posting is local").toContain("local");
  });

  it("R3: install appears within the first 60 lines; CLI table names every command with doc links", () => {
    const installAt = lines.findIndex((l) => l.trim().toLowerCase().startsWith("## install"));
    expect(installAt).toBeGreaterThan(-1);
    expect(installAt).toBeLessThanOrEqual(60);
    for (const cmd of ["--svg", "--quota", "--check-budget"]) {
      expect(readme).toContain(cmd);
    }
    // Design-mandated linked rows: each command's table row must carry a doc link.
    for (const cmd of ["aireceipts pr", "compare", "week", "--handoff", "install-hook", "statusline", "--json"]) {
      const row = lines.find((l) => l.startsWith("|") && l.includes(cmd));
      expect(row, `CLI table row missing for ${cmd}`).toBeDefined();
      expect(row!.includes("]("), `CLI table row for ${cmd} must link its doc`).toBe(true);
    }
  });
});
