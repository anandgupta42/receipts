// NO_COLOR / FORCE_COLOR / TTY handling for the receipt renderer. Colors
// default OFF unless the output stream is a real TTY, so piped/redirected
// output (and golden-test capture) stays byte-stable by default; NO_COLOR
// always wins over everything, per https://no-color.org/.
export function colorEnabled(stream: NodeJS.WriteStream | undefined = process.stdout): boolean {
  if (process.env.NO_COLOR !== undefined && process.env.NO_COLOR !== "") {
    return false;
  }
  if (process.env.FORCE_COLOR !== undefined && process.env.FORCE_COLOR !== "0") {
    return true;
  }
  return Boolean(stream && stream.isTTY);
}

export interface Colorizer {
  dim: (s: string) => string;
  bold: (s: string) => string;
}

const PLAIN: Colorizer = { dim: (s) => s, bold: (s) => s };

/** Minimal color per R5: dim rules/perforations, bold the TOTAL line — nothing else. */
export function makeColorizer(enabled: boolean): Colorizer {
  if (!enabled) {
    return PLAIN;
  }
  return {
    dim: (s: string) => `[2m${s}[22m`,
    bold: (s: string) => `[1m${s}[22m`,
  };
}
