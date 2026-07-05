// v0.1.0 release-board QA finding (HIGH): transcript-derived text reached the
// terminal with raw ESC/CSI/OSC bytes intact — a title could recolor output or
// retitle the terminal via OSC-0. These tests pin the sanitation boundary:
// `sanitizeText` (unit), the Claude Code title + tool-name paths.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { ClaudeCodeAdapter } from "../../src/parse/claudeCode.js";
import { sanitizeText, truncate } from "../../src/parse/util.js";

const dir = mkdtempSync(path.join(tmpdir(), "aireceipts-sanitize-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const ESC = String.fromCharCode(0x1b);
const BEL = String.fromCharCode(0x07);
// The QA repro payload, byte for byte: CSI color + OSC-0 terminal retitle (BEL-terminated).
const HOSTILE = `${ESC}[31mFAKE ERROR${ESC}[0m${ESC}]0;pwned${BEL} hi there`;

describe("sanitizeText (unit)", () => {
  it("strips CSI color, OSC-0 retitle (the QA repro), leaving only the visible text", () => {
    expect(sanitizeText(HOSTILE)).toBe("FAKE ERROR hi there");
  });

  it("strips an ST-terminated (ESC-backslash) OSC sequence", () => {
    expect(sanitizeText(`a${ESC}]0;title${ESC}\\b`)).toBe("ab");
  });

  it("strips nF escape forms whole (ESC + intermediates + final), e.g. the ESC ( B charset designator", () => {
    expect(sanitizeText(`a${ESC}(Bb`)).toBe("ab");
  });

  it("strips C0/C1 controls and DEL", () => {
    const nul = String.fromCharCode(0x00);
    const del = String.fromCharCode(0x7f);
    const c1 = String.fromCharCode(0x9f);
    expect(sanitizeText(`a${nul}b${BEL}c${del}d${c1}e`)).toBe("abcde");
  });

  it("strips tab/CR/newline too (display strings never carry raw line breaks; CR could redraw a row)", () => {
    expect(sanitizeText("a\tb\r\nc")).toBe("abc");
  });

  it("leaves ordinary text untouched", () => {
    expect(sanitizeText("plain — text with unicode 字 🚀")).toBe("plain — text with unicode 字 🚀");
  });

  it("adversarial: an unterminated OSC keeps the visible prefix and drops no ESC byte silently", () => {
    const out = sanitizeText(`before${ESC}]0;stolen`);
    expect(out).toContain("before");
    expect(out).not.toContain(ESC);
  });

  it("truncate composes sanitation with whitespace collapsing", () => {
    expect(truncate(`  ${HOSTILE}  `)).toBe("FAKE ERROR hi there");
  });
});

describe("adapter title + tool-name paths carry no escape bytes", () => {
  it("Claude Code: hostile first-user-text title and tool name come out clean (QA repro)", async () => {
    const file = path.join(dir, "hostile.jsonl");
    writeFileSync(
      file,
      [
        JSON.stringify({
          type: "user",
          timestamp: "2026-01-01T00:00:00Z",
          sessionId: "s1",
          uuid: "u1",
          message: { role: "user", content: [{ type: "text", text: HOSTILE }] },
        }),
        JSON.stringify({
          type: "assistant",
          timestamp: "2026-01-01T00:00:01Z",
          sessionId: "s1",
          uuid: "u2",
          message: {
            role: "assistant",
            model: "claude-opus-4-8",
            content: [{ type: "tool_use", id: "t1", name: `Ba${ESC}[31msh`, input: {} }],
            usage: { input_tokens: 10, output_tokens: 5 },
          },
        }),
      ].join("\n") + "\n",
    );
    const s = await new ClaudeCodeAdapter().loadSession(file);
    expect(s?.title).toBe("FAKE ERROR hi there");
    expect(s?.turns[0]?.toolCalls[0]?.name).toBe("Bash");
    expect(JSON.stringify(s)).not.toContain(ESC);
  });

  it("Claude Code: a hostile ai-title record is sanitized too", async () => {
    const file = path.join(dir, "hostile-aititle.jsonl");
    writeFileSync(
      file,
      [
        JSON.stringify({ type: "ai-title", timestamp: "2026-01-01T00:00:00Z", sessionId: "s2", uuid: "u1", aiTitle: HOSTILE }),
        JSON.stringify({
          type: "assistant",
          timestamp: "2026-01-01T00:00:01Z",
          sessionId: "s2",
          uuid: "u2",
          message: { role: "assistant", model: "claude-opus-4-8", content: [{ type: "text", text: "ok" }], usage: { input_tokens: 10, output_tokens: 5 } },
        }),
      ].join("\n") + "\n",
    );
    const s = await new ClaudeCodeAdapter().loadSession(file);
    expect(s?.title ?? "").not.toContain(ESC);
  });

  it("Claude Code: a hostile model id is sanitized in the receipt's model-mix label, pricing unaffected", async () => {
    const file = path.join(dir, "hostile-model.jsonl");
    writeFileSync(
      file,
      [
        JSON.stringify({ type: "user", timestamp: "2026-01-01T00:00:00Z", sessionId: "s3", uuid: "u1", message: { role: "user", content: [{ type: "text", text: "hi" }] } }),
        JSON.stringify({
          type: "assistant",
          timestamp: "2026-01-01T00:00:01Z",
          sessionId: "s3",
          uuid: "u2",
          message: { role: "assistant", model: `claude${ESC}[31m-opus-4-8`, content: [{ type: "text", text: "ok" }], usage: { input_tokens: 10, output_tokens: 5 } },
        }),
      ].join("\n") + "\n",
    );
    const { buildReceiptModel } = await import("../../src/receipt/model.js");
    const s = await new ClaudeCodeAdapter().loadSession(file);
    const model = await buildReceiptModel(s!);
    expect(model.modelMix.map((m) => m.model).join(" ")).not.toContain(ESC);
  });

  it("Claude Code: a CR-spoofed tool name cannot redraw a row (CR stripped)", async () => {
    const CR = String.fromCharCode(0x0d);
    const file = path.join(dir, "hostile-cr-tool.jsonl");
    writeFileSync(
      file,
      [
        JSON.stringify({ type: "user", timestamp: "2026-01-01T00:00:00Z", sessionId: "s4", uuid: "u1", message: { role: "user", content: [{ type: "text", text: "hi" }] } }),
        JSON.stringify({
          type: "assistant",
          timestamp: "2026-01-01T00:00:01Z",
          sessionId: "s4",
          uuid: "u2",
          message: { role: "assistant", model: "claude-opus-4-8", content: [{ type: "tool_use", id: "t1", name: `Bash${CR}TOTAL`, input: {} }], usage: { input_tokens: 10, output_tokens: 5 } },
        }),
      ].join("\n") + "\n",
    );
    const s = await new ClaudeCodeAdapter().loadSession(file);
    expect(s?.turns[0]?.toolCalls[0]?.name).toBe("BashTOTAL");
    expect(s?.turns[0]?.toolCalls[0]?.name ?? "").not.toContain(CR);
  });
});
