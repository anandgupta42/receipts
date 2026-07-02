import { createInterface } from "node:readline/promises";
import type { Readable, Writable } from "node:stream";

/**
 * R1: every `benchmark` invocation re-prompts `[y/N]` — v1 has no
 * persisted "always allow" (SPEC-0015 Non-goals). Built from Node
 * built-ins only; the project has no CLI-prompt dependency and this is a
 * single yes/no question, not a case for adding one. `input`/`output` are
 * injectable so tests never touch the real TTY.
 */
export async function confirmPrompt(question: string, input: Readable = process.stdin, output: Writable = process.stdout): Promise<boolean> {
  const rl = createInterface({ input, output });
  try {
    const answer = await rl.question(`${question} [y/N] `);
    return answer.trim().toLowerCase() === "y" || answer.trim().toLowerCase() === "yes";
  } finally {
    rl.close();
  }
}
