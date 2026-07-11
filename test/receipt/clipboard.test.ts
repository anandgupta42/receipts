// SPEC-0077 R6 — the local clipboard image-copy: platform command selection and
// the best-effort fallback contract. The real spawn is never exercised here; a
// fake ClipboardRunner records attempts so the tests assert ordering and the
// never-throws degrade, and that the ONLY tool ever named is a clipboard tool.
import { describe, expect, it, vi } from "vitest";
import { CLIPBOARD_IMAGE_ENV, clipboardCommandsFor, copyImageToClipboard, type ClipboardCommand } from "../../src/receipt/clipboard.js";

const PATH = "/tmp/aireceipts/card.png";

describe("clipboardCommandsFor — platform command selection", () => {
  it("macOS reads the file into the clipboard via osascript (PNGf), path out-of-band via env", () => {
    const cmds = clipboardCommandsFor(PATH, "darwin");
    expect(cmds).toHaveLength(1);
    expect(cmds[0].cmd).toBe("osascript");
    expect(cmds[0].args.join(" ")).toContain("«class PNGf»");
    // Safety: the path is passed via env, NEVER interpolated into the -e script.
    expect(cmds[0].env).toEqual({ [CLIPBOARD_IMAGE_ENV]: PATH });
    expect(cmds[0].args.join(" ")).not.toContain(PATH);
    expect(cmds[0].args.join(" ")).toContain(`system attribute "${CLIPBOARD_IMAGE_ENV}"`);
  });

  it("Linux tries wl-copy then xclip, both typed image/png", () => {
    const cmds = clipboardCommandsFor(PATH, "linux");
    expect(cmds.map((c) => c.cmd)).toEqual(["wl-copy", "xclip"]);
    expect(cmds[0].stdinFile).toBe(PATH); // wl-copy reads stdin bytes
    expect(cmds[0].args).toEqual(["--type", "image/png"]);
    expect(cmds[1].args).toContain("image/png");
    expect(cmds[1].args).toContain(PATH); // xclip reads the path as a literal argv element
  });

  it("Windows uses a single PowerShell subprocess, path out-of-band via env", () => {
    const cmds = clipboardCommandsFor(PATH, "win32");
    expect(cmds).toHaveLength(1);
    expect(cmds[0].cmd).toBe("powershell");
    // Safety: the path is read from $env:, NEVER interpolated into -Command.
    expect(cmds[0].env).toEqual({ [CLIPBOARD_IMAGE_ENV]: PATH });
    expect(cmds[0].args.join(" ")).not.toContain(PATH);
    expect(cmds[0].args.join(" ")).toContain(`$env:${CLIPBOARD_IMAGE_ENV}`);
  });

  it("an unrecognized platform has no clipboard command (copy unavailable)", () => {
    expect(clipboardCommandsFor(PATH, "aix" as NodeJS.Platform)).toEqual([]);
  });

  it("never names a browser opener on any platform", () => {
    const browsers = /open|xdg-open|start|firefox|chrome|safari|edge/;
    for (const platform of ["darwin", "linux", "win32"] as NodeJS.Platform[]) {
      for (const cmd of clipboardCommandsFor(PATH, platform)) {
        expect(cmd.cmd).not.toMatch(browsers);
        expect(cmd.args.join(" ")).not.toContain("http");
      }
    }
  });
});

describe("clipboardCommandsFor — a hostile path never reaches a script string (I1/safety)", () => {
  // A path crafted to execute code if it were ever interpolated into a shell,
  // AppleScript, or PowerShell program: PowerShell `$(...)`, backticks, quotes.
  const HOSTILE = '/tmp/$(touch pwned)/`whoami`/"; calc; ".png';

  for (const platform of ["darwin", "win32"] as NodeJS.Platform[]) {
    it(`${platform}: the path travels only in env, verbatim — the -e/-Command script is a fixed constant`, () => {
      const cmds = clipboardCommandsFor(HOSTILE, platform);
      expect(cmds).toHaveLength(1);
      const cmd = cmds[0];
      // The path is carried literally in env, never appearing in argv (the script).
      expect(cmd.env).toEqual({ [CLIPBOARD_IMAGE_ENV]: HOSTILE });
      const script = cmd.args.join(" ");
      expect(script).not.toContain(HOSTILE);
      // No fragment of the injection payload leaks into the program either.
      expect(script).not.toContain("touch pwned");
      expect(script).not.toContain("$(");
      expect(script).not.toContain("`");
    });
  }

  it("linux: xclip receives the hostile path as one literal argv element (no shell); wl-copy reads bytes", () => {
    const cmds = clipboardCommandsFor(HOSTILE, "linux");
    const xclip = cmds.find((c) => c.cmd === "xclip");
    const wlcopy = cmds.find((c) => c.cmd === "wl-copy");
    // The whole path is exactly one argv element — argv is never shell-interpreted.
    expect(xclip!.args).toContain(HOSTILE);
    expect(xclip!.args.filter((a) => a === HOSTILE)).toHaveLength(1);
    expect(wlcopy!.stdinFile).toBe(HOSTILE);
    expect(wlcopy!.args.join(" ")).not.toContain(HOSTILE);
  });
});

describe("copyImageToClipboard — best-effort ordering + degrade", () => {
  it("returns true on the first successful attempt (macOS: one call)", () => {
    const run = vi.fn(() => ({ ok: true }));
    expect(copyImageToClipboard(PATH, "darwin", run)).toBe(true);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("falls through wl-copy → xclip on Linux and succeeds on the second", () => {
    const seen: string[] = [];
    const run = vi.fn((c: ClipboardCommand) => {
      seen.push(c.cmd);
      return { ok: c.cmd === "xclip" };
    });
    expect(copyImageToClipboard(PATH, "linux", run)).toBe(true);
    expect(seen).toEqual(["wl-copy", "xclip"]);
  });

  it("returns false when every attempt fails (tool missing / non-zero)", () => {
    const run = vi.fn(() => ({ ok: false }));
    expect(copyImageToClipboard(PATH, "linux", run)).toBe(false);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("returns false without ever spawning on an unsupported platform", () => {
    const run = vi.fn(() => ({ ok: true }));
    expect(copyImageToClipboard(PATH, "sunos" as NodeJS.Platform, run)).toBe(false);
    expect(run).not.toHaveBeenCalled();
  });
});
