// SPEC-0077 R6 — copy a rendered card IMAGE onto the OS clipboard, best-effort.
// This is the ONLY subprocess the share step spawns: a local, platform-native
// clipboard tool. No browser, no network, no upload (I1/I4). Every failure mode
// — tool missing, non-zero exit, unsupported platform — degrades to `false`, and
// the caller prints a one-line "clipboard copy unavailable" note and continues;
// the image is already on disk regardless.
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

/**
 * SPEC-0077 R6 (safety) — the env var the image path travels in for the tools
 * that read the path themselves (osascript/PowerShell). The path is NEVER
 * interpolated into a script/shell string: a path containing `$()`, backticks,
 * or quotes would otherwise execute as code (PowerShell expands `$(...)` inside
 * a double-quoted literal; AppleScript/osascript interprets its whole `-e`
 * program). Passing it out-of-band as an environment value keeps it inert data.
 */
export const CLIPBOARD_IMAGE_ENV = "AIRECEIPTS_CLIPBOARD_IMAGE";

/** One clipboard attempt: the local tool plus its args. `stdinFile`, when set, is streamed as raw bytes (image tools that read stdin); `env` carries the image path out-of-band for tools that read it themselves. */
export interface ClipboardCommand {
  cmd: string;
  args: string[];
  /** Absolute path whose raw bytes feed the tool's stdin (wl-copy); omitted when the tool reads the path itself (osascript/PowerShell via `env`) or as a literal argv element (xclip). */
  stdinFile?: string;
  /** Extra environment for the child (the image path for osascript/PowerShell) — never interpolated into the script string, so a hostile path can't inject code (I1/safety). */
  env?: Record<string, string>;
}

/** Runs one clipboard command. Never throws — a spawn failure is `{ ok: false }`. Injected in tests so no real clipboard tool is spawned. */
export type ClipboardRunner = (command: ClipboardCommand) => { ok: boolean };

/** The production clipboard runner: a single `spawnSync`, raw-byte stdin for the image-from-stdin tools, the image path passed via `env` (never the shell/script). */
export const defaultClipboardRunner: ClipboardRunner = (command) => {
  try {
    const input = command.stdinFile !== undefined ? readFileSync(command.stdinFile) : undefined;
    const env = command.env !== undefined ? { ...process.env, ...command.env } : process.env;
    const res = spawnSync(command.cmd, command.args, { input, timeout: 5000, env });
    return { ok: !res.error && res.status === 0 };
  } catch {
    return { ok: false };
  }
};

/**
 * The ordered clipboard-copy attempts for a PNG at `imagePath` on `platform`.
 * Linux tries Wayland (`wl-copy`) then X11 (`xclip`); other platforms have one
 * command each. An unrecognized platform returns `[]` (clipboard unavailable).
 * The path is only ever passed as a literal argv element (xclip), as raw stdin
 * bytes (wl-copy), or via `env` (osascript/PowerShell) — never interpolated
 * into a script string, so a path with `$()`/backticks/quotes cannot execute.
 */
export function clipboardCommandsFor(imagePath: string, platform: NodeJS.Platform): ClipboardCommand[] {
  switch (platform) {
    case "darwin":
      // osascript reads the path from the environment (`system attribute`), so
      // the AppleScript program is a fixed constant — the path never enters it.
      return [
        {
          cmd: "osascript",
          args: ["-e", `set the clipboard to (read (POSIX file (system attribute "${CLIPBOARD_IMAGE_ENV}")) as «class PNGf»)`],
          env: { [CLIPBOARD_IMAGE_ENV]: imagePath },
        },
      ];
    case "linux":
      // wl-copy reads raw bytes from stdin; xclip takes the path as a literal
      // argv element (spawn without a shell — not interpreted). Neither embeds
      // the path in a script string.
      return [
        { cmd: "wl-copy", args: ["--type", "image/png"], stdinFile: imagePath },
        { cmd: "xclip", args: ["-selection", "clipboard", "-t", "image/png", "-i", imagePath] },
      ];
    case "win32":
      // PowerShell image clipboard: Set-Clipboard cannot carry raw image bytes,
      // so this uses the WinForms Clipboard.SetImage the platform actually
      // supports. Still a single local PowerShell subprocess, best-effort. The
      // path is read from `$env:` — never interpolated into the -Command script,
      // which would let `$(...)`/backticks in the path execute.
      return [
        {
          cmd: "powershell",
          args: [
            "-NoProfile",
            "-Command",
            `Add-Type -AssemblyName System.Windows.Forms,System.Drawing; [System.Windows.Forms.Clipboard]::SetImage([System.Drawing.Image]::FromFile($env:${CLIPBOARD_IMAGE_ENV}))`,
          ],
          env: { [CLIPBOARD_IMAGE_ENV]: imagePath },
        },
      ];
    default:
      return [];
  }
}

/**
 * SPEC-0077 R6 — copy the PNG at `imagePath` onto the clipboard. Returns true on
 * the first attempt that succeeds, false when no platform tool is available or
 * every attempt failed. Best-effort by contract: never throws, never blocks the
 * command.
 */
export function copyImageToClipboard(
  imagePath: string,
  platform: NodeJS.Platform,
  run: ClipboardRunner = defaultClipboardRunner,
): boolean {
  for (const command of clipboardCommandsFor(imagePath, platform)) {
    if (run(command).ok) {
      return true;
    }
  }
  return false;
}
