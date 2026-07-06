// SPEC-0058 R4 — per-agent doc pages can't drift from the adapter registry:
// one page per registered source id (a new adapter without a page fails
// here), required sections present, README table links every page, and
// Cursor's degraded-mode honesty leads its page.
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { AGENT_SOURCES } from "../src/parse/types.js";

const readme = readFileSync("README.md", "utf8");

describe("SPEC-0058 · per-agent pages", () => {
  it("R1/R4: exactly one page per registered adapter source id", () => {
    for (const source of AGENT_SOURCES) {
      expect(existsSync(`docs/agents/${source}.md`), `missing page for adapter "${source}" — a new adapter ships with its docs page`).toBe(true);
    }
  });

  it("R1: every page carries the required sections", () => {
    for (const source of AGENT_SOURCES) {
      const page = readFileSync(`docs/agents/${source}.md`, "utf8");
      for (const heading of ["## What you get", "## Where transcripts live", "## Quick start", "## Privacy"]) {
        expect(page, `${source}.md missing "${heading}"`).toContain(heading);
      }
      expect(page, `${source}.md must link the PR-receipts guide`).toContain("../pr-receipts.md");
    }
  });

  it("R2: stated transcript locations match the shipped adapters", () => {
    const expectations: Record<string, string> = {
      "claude-code": "~/.claude/projects",
      codex: "~/.codex/sessions",
      gemini: "~/.gemini/tmp",
      cursor: "state.vscdb",
      opencode: ".local/share/opencode",
    };
    for (const [source, location] of Object.entries(expectations)) {
      const page = readFileSync(`docs/agents/${source}.md`, "utf8");
      expect(page, `${source}.md must name its real read location`).toContain(location);
    }
  });

  it("R2: Cursor's degraded mode leads the page — before any promise", () => {
    const page = readFileSync("docs/agents/cursor.md", "utf8");
    const firstLines = page.split("\n").slice(0, 15).join("\n");
    expect(firstLines).toContain("session totals only");
  });

  it("R3: the README Supported-agents table links every page, and the index lists all five", () => {
    for (const source of AGENT_SOURCES) {
      expect(readme, `README must link docs/agents/${source}.md`).toContain(`docs/agents/${source}.md`);
    }
    const index = readFileSync("docs/agents/README.md", "utf8");
    for (const source of AGENT_SOURCES) {
      expect(index, `index must list ${source}.md`).toContain(`${source}.md`);
    }
  });
});
