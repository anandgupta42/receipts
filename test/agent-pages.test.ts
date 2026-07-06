// SPEC-0058 R4 — per-agent doc pages can't drift from the adapter registry:
// one page per registered source id (a new adapter without a page fails
// here), required sections present, README table links every page, and
// Cursor's degraded-mode honesty leads its page.
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { agentIds } from "../src/parse/registry.js";

const readme = readFileSync("README.md", "utf8");
// R1 names the registry as the source of truth — not the AGENT_SOURCES type list.
const AGENT_SOURCES = agentIds();

describe("SPEC-0058 · per-agent pages", () => {
  it("R1/R4: exactly one page per registered adapter — no missing, no orphan pages", () => {
    const pages = readdirSync("docs/agents")
      .filter((f) => f.endsWith(".md") && f !== "README.md")
      .map((f) => f.replace(/\.md$/, ""))
      .sort();
    expect(pages, "docs/agents/*.md must be exactly the registry's adapter ids").toEqual([...AGENT_SOURCES].sort());
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
    // The shipped adapter flags every session unpriceable — the page must say
    // dollars never render, and must not claim priced totals.
    expect(firstLines).toContain("never renders dollars");
    expect(page).not.toContain("priced total");
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
