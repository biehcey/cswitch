# Changelog

All notable changes to this project are documented here.

## [Unreleased]

## [0.1.6] - 2026-09-07

- Rewrote `README.md` against the current command surface: interactive mode, the full command
  table (`remove`, `unbind`, `status`, `bind --list`, `add --bind`), the `[no binding — default]`
  banner and `-q`/`CSWITCH_QUIET`, and the 64/70 exit-code contract.
- `cswitch --help` now documents interactive mode.

## [0.1.5] - 2026-09-07

- Interactive mode hides the terminal cursor while a screen is up, so it no longer sits parked
  under the profile list on a screen you can only drive with keypresses. It is restored on every
  exit path — Esc, Ctrl-C, and before the launched `claude` takes over the terminal.

## [0.1.4] - 2026-09-07

- Added Interactive Mode: `cswitch` with no arguments, on a real terminal, opens the profile list.
  Arrow keys move, `enter` runs `claude` in the selected profile, `a` adds a profile, `d` deletes
  one, `esc` quits. On a first run it walks through setup before showing the list. Without a TTY,
  a bare `cswitch` still prints help and exits 64.

## [0.1.3] - 2026-09-04

- First published release: `init` → `add` → `shell-init` setup flow, `bind`/`unbind` with
  longest-prefix resolution, `status [--json]`, `remove [--force]` with best-effort macOS Keychain
  cleanup, and the launcher core.
- 0.1.0 through 0.1.2 were tagged but never reached npm — release-workflow fixes only, with no
  user-facing change between them and 0.1.3.
