# Install

aireceipts is a Node CLI. It needs **Node.js 20 or newer** and nothing else — no
account, no API key, no daemon.

## The short version: don't install

```sh
npx aireceipts-cli
```

`npx` fetches and runs the latest published version each time. For an occasional
receipt, that's the whole story — skip the rest of this page.

## Install it globally

If you run it often, put `aireceipts` on your `PATH`:

```sh
npm install -g aireceipts-cli
aireceipts            # now available directly
```

> **Pre-release note.** Until the npm package is published, install from source:
>
> ```sh
> git clone https://github.com/<owner>/receipts
> cd receipts
> npm install
> npm run build
> node dist/cli.js        # this is your `aireceipts`
> ```
>
> The commands in these docs are written as `aireceipts …`; with a source
> checkout, read that as `node dist/cli.js …`.

## Upgrade

- **`npx aireceipts-cli`** always runs the latest release — nothing to upgrade.
- **Global install:** `npm update -g aireceipts-cli`.
- **Source checkout:** `git pull && npm install && npm run build`.

## Uninstall

Remove the global binary:

```sh
npm uninstall -g aireceipts-cli
```

If you added the automatic Claude Code hook, remove it too — it's a separate,
consent-gated change to your Claude Code settings:

```sh
aireceipts uninstall-hook
```

See [Install the agent hook](03-install-hook.md) for what that command touches.
aireceipts keeps its own small state (the first-run notice flag, an optional
budget file, a summary cache) under `~/.aireceipts/`; delete that directory to
remove it.

## Next

- **[Get started](01-getting-started.md)** — your first receipt, week, and hook.
- **[Install the agent hook](03-install-hook.md)** — a receipt after every session.
