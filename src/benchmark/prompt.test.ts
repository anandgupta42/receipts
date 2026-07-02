import { Readable, Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import { confirmPrompt } from "./prompt.js";

function inputStream(line: string): Readable {
  return Readable.from([`${line}\n`]);
}

function sinkStream(): Writable {
  return new Writable({
    write(_chunk, _encoding, callback) {
      callback();
    },
  });
}

describe("confirmPrompt (R1: per-call [y/N], no persisted 'always allow')", () => {
  it.each(["y", "Y", "yes", "YES", "Yes"])("accepts %s as confirmation", async (answer) => {
    expect(await confirmPrompt("Send?", inputStream(answer), sinkStream())).toBe(true);
  });

  it.each(["n", "N", "no", "", "maybe", "sure"])("rejects %s (default is no)", async (answer) => {
    expect(await confirmPrompt("Send?", inputStream(answer), sinkStream())).toBe(false);
  });

  it("writes the [y/N] prompt text to the provided output stream", async () => {
    const chunks: string[] = [];
    const output = new Writable({
      write(chunk, _encoding, callback) {
        chunks.push(chunk.toString());
        callback();
      },
    });
    await confirmPrompt("Send anonymous benchmark data?", inputStream("n"), output);
    expect(chunks.join("")).toContain("Send anonymous benchmark data? [y/N]");
  });
});
