# cswitch

Run multiple Claude Code accounts (say, work and personal) on the same machine, side by side,
without logging in and out. `cswitch` gives each account its own isolated identity while sharing
your settings and installed plugins, and picks the right one automatically based on which
directory you're in.

```
$ claude
cswitch: work · batuhan.ardic@mikrokom.com · Mikrokom
```

## Install

```bash
npm i -g cswitch
```

Requires Node.js ≥ 20.19.

## Setup

```bash
cswitch init
```

Registers your existing `~/.claude` as the default profile — it is never moved, copied, or
written to. Then create a profile for your other account:

```bash
cswitch add personal
cswitch personal -- claude
```

The second command runs `claude` inside the new profile so you can log in; the login flow opens
there. Finally, wire up your shell so plain `claude` goes through cswitch automatically:

```bash
# bash / zsh — add to ~/.bashrc or ~/.zshrc
eval "$(cswitch shell-init zsh)"

# fish — add to ~/.config/fish/config.fish
cswitch shell-init fish | source

# PowerShell — add to $PROFILE
cswitch shell-init powershell | Out-String | iex
```

## Daily use

Once the shell hook is installed, just run `claude` as usual — cswitch picks the profile bound to
your current directory (or the default profile if nothing matches) and runs `claude` there.

To bind a directory to a profile:

```bash
cswitch bind ~/src/personal personal
```

To override the binding for one command, name the profile explicitly:

```bash
cswitch personal -- claude
```

## Uninstall

Delete `~/.cswitch` and remove the `cswitch shell-init` line from your shell profile. Your
default account is untouched — `~/.claude` was never moved or modified, so plain `claude`
keeps working exactly as before.

```bash
rm -rf ~/.cswitch
```

## Known limits

- No `cmd.exe` support — use PowerShell on Windows.
- IDE and editor plugins are out of scope; `CLAUDE_CONFIG_DIR` only affects the CLI.
- Global config keys (`autoConnectIde`, `diffTool`, and similar) are not shared between
  profiles — each one is set up independently.

---

To try cswitch without installing it globally: `npx cswitch@latest`.
