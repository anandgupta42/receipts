// SPEC-0018 R7: the SVG/PNG file-write helpers shared by the receipt and compare
// commands, under common ownership. Writes go through the context's `fs` and
// `stdout` seams (R3) so a command's output path is injectable in tests. Moved
// verbatim (byte-identical "wrote <path> (<n> bytes)" line) from the pre-refactor
// dispatcher.
import type { CommandContext } from "../types.js";
import type { CliOptions } from "../options.js";
import type { HookIo } from "../../hook/install.js";

/** The output-mode slice of the parsed options the receipt/compare renderers read. */
export interface SvgOut {
  svg: boolean;
  png: boolean;
  theme: "light" | "dark";
  output?: string;
}

export function svgOutOf(options: CliOptions): SvgOut {
  return { svg: options.svg, png: options.png, theme: options.theme, output: options.output };
}

export async function writeSvg(ctx: CommandContext, svg: string, path: string): Promise<void> {
  await ctx.fs.writeFile(path, svg);
  ctx.stdout.write(`wrote ${path} (${Buffer.byteLength(svg)} bytes)\n`);
}

export async function writePng(ctx: CommandContext, png: Buffer, path: string): Promise<void> {
  await ctx.fs.writeFile(path, png);
  ctx.stdout.write(`wrote ${path} (${png.length} bytes)\n`);
}

/** The hook install/uninstall I/O seam, wired to the context (confirm + line writers). */
export function hookIoFor(ctx: CommandContext): HookIo {
  return {
    confirm: (question) => ctx.prompt(question),
    out: (s) => ctx.stdout.write(`${s}\n`),
    err: (s) => ctx.stderr.write(`${s}\n`),
  };
}
