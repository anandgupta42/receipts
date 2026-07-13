#!/usr/bin/env node

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const REGISTRY_PATH = join(ROOT, "src", "receipt", "review-patterns.json");
const OUTPUT_PATH = join(ROOT, "docs", "reference", "review-patterns.md");
const CHECK = process.argv.includes("--check");
const TICK = String.fromCharCode(96);

const STATUS = Object.freeze({
  costOpportunity: {
    label: "Shown as a cost opportunity",
    explanation: "Shown when listed prices give a lower arithmetic result for the same recorded usage.",
  },
  enabled: {
    label: "Shown as an issue",
    explanation: "Shown when the recorded evidence matches the rule.",
  },
  diagnostic: {
    label: "Shown as something to watch",
    explanation: "Shown with an extra caution because there may be a reasonable explanation.",
  },
  shadow: {
    label: "Measured only",
    explanation: "Evaluated during development, but not shown in command output or sent in telemetry.",
  },
  disabled: {
    label: "Not run",
    explanation: "Kept in the registry so the idea and its limitations are not lost, but it is not evaluated.",
  },
});

function statusFor(pattern) {
  return pattern.rollout.state === "enabled" && pattern.category === "cost-opportunity"
    ? STATUS.costOpportunity
    : STATUS[pattern.rollout.state];
}

function code(value) {
  return TICK + value + TICK;
}

function renderReference(registry) {
  const patterns = Object.entries(registry.patterns).sort(([, left], [, right]) => left.order - right.order);
  const lines = [
    "# Session review pattern reference",
    "",
    "This page lists every idea considered for session review, including ideas that are not currently shown. It is generated from the same registry the command uses, so the wording here cannot quietly drift from the product.",
    "",
    "Run " + code("aireceipts review") + " to inspect a completed coding session. The review reports only what the saved trace can support, explains why it may matter, and gives one prevention step for next time.",
    "",
    "## What the statuses mean",
    "",
    "| Status | Meaning |",
    "|---|---|",
    ...Object.values(STATUS).map((status) => "| " + status.label + " | " + status.explanation + " |"),
    "",
    "Registry version: " + registry.registryVersion + ". Pattern count: " + patterns.length + ".",
    "",
  ];

  for (const [id, pattern] of patterns) {
    const status = statusFor(pattern);
    lines.push(
      "## " + pattern.title,
      "",
      "- Pattern key: " + code(id),
      "- Status: " + status.label,
      "- Rule version: " + pattern.ruleVersion,
      "",
      "What it notices: " + pattern.description,
      "",
      "Why it may matter: " + pattern.whyItMatters,
      "",
      "Prevent it next time: " + pattern.recommendation,
      "",
      "What the evidence cannot prove: " + pattern.claimLimit,
      "",
    );

    if (pattern.recurrence.eligible) {
      const prefix = pattern.rollout.state === "disabled" || pattern.rollout.state === "shadow"
        ? "If enabled later, its recurrence rule would require "
        : "Repeated pattern: The review can say this recurred after it appears in ";
      lines.push(
        prefix +
          "at least " +
          pattern.recurrence.minimumDistinctSessions +
          " distinct sessions within " +
          pattern.recurrence.windowDays +
          " days.",
        "",
      );
    }

    if (pattern.rollout.state === "disabled" || pattern.rollout.state === "shadow") {
      lines.push("Why it is not shown now: " + pattern.rollout.reason, "");
    }
  }

  return lines.join("\n").trimEnd() + "\n";
}

const registry = JSON.parse(readFileSync(REGISTRY_PATH, "utf8"));
const expected = renderReference(registry);

if (CHECK) {
  let actual;
  try {
    actual = readFileSync(OUTPUT_PATH, "utf8");
  } catch {
    console.error("Missing generated review pattern reference: " + OUTPUT_PATH);
    process.exitCode = 1;
    process.exit();
  }
  if (actual !== expected) {
    console.error("Review pattern reference is stale. Run: node scripts/generate-review-reference.mjs");
    process.exitCode = 1;
  }
} else {
  mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
  writeFileSync(OUTPUT_PATH, expected, "utf8");
  console.log("Wrote " + OUTPUT_PATH);
}
