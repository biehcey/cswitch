# Changelog

All notable changes to this project are documented here.

## [Unreleased]

- The launched process gets `CSWITCH_PROFILE` set to the profile's name, including for the default
  profile, so scripts such as a Claude Code status line can show which profile they run under. The
  README has a `statusLine` example for macOS/Linux and Windows.

## [0.6.0] - 2026-11-03

- Interactive mode's usage limits also show how long until each window resets:
  `5h 91% (1h 20m) · week 40% (3d 13h)`. The time comes from the same Anthropic response as the
  percents and is never written to disk. If it is missing or already past, only the percent shows.

## [0.5.1] - 2026-11-02

- Interactive mode draws on the terminal's alternate screen, so quitting it (Esc or Ctrl-C) or
  launching `claude` from it gives back the terminal exactly as it was, instead of leaving the
  last frame of the list above the prompt.

## [0.5.0] - 2026-11-02

- Interactive mode opens with a colored `cswitch` banner and a one-line tagline instead of the
  plain bold title.
- README starts with a banner image.
- Interactive mode shows each account's 5-hour and weekly usage limits at the end of its row
  (`5h 37% · week 7%`), yellow from 80% and red from 95% — the numbers `/usage` shows in Claude
  Code. They are fetched from Anthropic with each profile's own login token, read-only and never
  refreshed; anything that goes wrong just leaves the numbers out. `CSWITCH_NO_USAGE=1` turns it
  off. See `docs/adr/0003-usage-limits.md`.

## [0.4.2] - 2026-11-02

- Fixed `cswitch` printing nothing and exiting on macOS and Linux after `npm install -g`. The
  command on PATH is a symlink there, and cswitch didn't recognize itself as the program being
  run when started through one. Windows was not affected.

## [0.4.1] - 2026-11-02

- Interactive mode's profile list got a cleaner look: a `cswitch` title and section headings
  instead of column headers, a colored dot per profile that its RECENT rows repeat, and RECENT
  rows that lead with the folder name and end with its parent path. The login state only shows
  when something is wrong — a red `(not logged in)` or yellow `(account unknown)` — and an
  organization name that only restates the email is left out. The default profile is marked
  `default` instead of `*`, and every screen's key hints read `enter run · esc quit` style.
- README documents RECENT and `cswitch recent`.

## [0.4.0] - 2026-11-02

- Interactive mode lists the directories you last ran `claude` in under a RECENT section below
  the profiles, read from every profile's own Claude Code history: one row per directory and
  profile, newest first, at most 10, with how long ago it was used. `enter`, `c`, `r` and `m` on a
  row run `claude` in that directory with that row's profile, even when the directory is bound to
  another profile — such rows are marked `≠binding`. Nothing is written, and `d` does nothing on
  these rows. See `docs/adr/0002-recent-directory-launch.md`.
- New `cswitch recent` prints the same list as a plain table.
- `recent` is now a subcommand name, so it can no longer be used as a new profile's name.

## [0.2.0] - 2026-09-07

- Interactive mode's profile list gained three one-key launches, alongside `enter`: `c` runs
  `claude --continue`, `r` runs `claude --resume`, and `m` runs `claude mcp list` — each in the
  selected profile, including the default one. They take the same one-off launch path `enter`
  does, so nothing is written and no binding is touched, and `cswitch` still ends when the
  command it started ends. `--dangerously-skip-permissions` is deliberately not on a key; see
  `docs/adr/0001-interactive-mode-launch-keys.md`.

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
