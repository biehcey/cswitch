import path from "node:path";
import { formatAccount } from "./account.js";
import { formatAgo, type RecentRow } from "./recent.js";
import { LAUNCH_ACTIONS, type LaunchAction } from "./interactive-actions.js";
import type { ProfileStatus } from "./status.js";
import { loginStateOf } from "./status.js";

// Raw ANSI SGR codes (spec §10.2): color is a deliberate exception to `status`'s
// colorless output, and no third-party package is introduced for it (spec §7).
const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const CYAN = "\x1b[36m";
const DIM = "\x1b[2m";
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";

export const CLEAR_SCREEN = "\x1b[2J\x1b[H";

// Every screen draws its own caret where one belongs (the add screen's `_`), so
// the terminal's real cursor is nothing but a stray block parked under the table
// on a keypress-driven screen. It is hidden for the whole session and restored
// on every exit path — Ctrl-C included — because a terminal left with an
// invisible cursor is as unusable as one left in raw mode (spec §10.3).
export const HIDE_CURSOR = "\x1b[?25l";
export const SHOW_CURSOR = "\x1b[?25h";

/** Renders one launch action as its footer hint, bracketing the key inside its
 * own label: `continue` → `[c]ontinue`. */
function actionHint(action: LaunchAction): string {
  return `[${action.key}]${action.label.slice(1)}`;
}

// Built from LAUNCH_ACTIONS rather than written out, so the footer and the keys
// `interactive.ts` actually dispatches can never drift apart (spec §10.3).
export const LIST_FOOTER_HINT = ["[enter] run", ...LAUNCH_ACTIONS.map(actionHint), "[a]dd", "[d] remove", "[esc] quit"].join("   ");

export const ADD_FOOTER_HINT = "[enter] create   [esc] cancel";

export const REMOVE_FOOTER_HINT = "[y] remove   [n/esc] cancel";

function pad(text: string, width: number): string {
  return text.length >= width ? text : text + " ".repeat(width - text.length);
}

/** Indents a possibly multi-line message and colors every line of it, so a message
 * that wraps stays visibly one block rather than trailing off uncolored. */
function messageBlock(text: string, color: string): string[] {
  return text.split("\n").map((line) => `  ${color}${line}${RESET}`);
}

function loginStateColor(state: ReturnType<typeof loginStateOf>): string {
  return state === "logged-in" ? GREEN : "";
}

/**
 * Renders the Profile list (spec §10.5) as a Dense table — name, Account, Login
 * State, Default marker — with a fixed key-hint footer (spec §10.2). Pure and
 * TTY-independent so it can be unit tested without a real terminal; the caller
 * is responsible for clearing the screen (`CLEAR_SCREEN`) before writing this.
 * `notice` carries a message that outlived the screen that produced it — a
 * best-effort Keychain or directory-delete warning from `removeProfile()`
 * (§6.4/§10.9), which the redraw after a deletion would otherwise wipe; the
 * flag-based `remove` writes the same text to stderr.
 */
export function renderProfileList(profiles: ProfileStatus[], selectedIndex: number, notice?: string, recent?: RecentSection): string {
  const nameWidth = Math.max(7, ...profiles.map((p) => p.name.length));
  const accountWidth = Math.max(7, ...profiles.map((p) => formatAccount(p.account).length));

  const header = `  ${pad("PROFILE", nameWidth)}  ${pad("ACCOUNT", accountWidth)}  ${pad("LOGIN STATE", 14)}  DEFAULT`;

  const rows = profiles.map((profile, index) => {
    const isSelected = index === selectedIndex;
    const cursor = isSelected ? "> " : "  ";
    const loginState = loginStateOf(profile.account);
    const marker = profile.inPlace ? "*" : "";
    // An embedded RESET here would cut short the outer BOLD+CYAN wrap below on a
    // selected row, so the per-state color is only applied on unselected rows.
    const loginStateField = isSelected ? pad(loginState, 14) : `${loginStateColor(loginState)}${pad(loginState, 14)}${RESET}`;
    const line = `${cursor}${pad(profile.name, nameWidth)}  ${pad(formatAccount(profile.account), accountWidth)}  ${loginStateField}  ${marker}`;
    return isSelected ? `${BOLD}${CYAN}${line}${RESET}` : line;
  });

  const footer = `${DIM}${LIST_FOOTER_HINT}${RESET}`;

  const noticeLines = notice === undefined ? [] : ["", ...messageBlock(notice, YELLOW)];

  const recentLines = recent === undefined ? [] : renderRecentSection(recent, selectedIndex - profiles.length);

  return [header, ...rows, ...recentLines, ...noticeLines, "", footer].join("\n") + "\n";
}

/** Everything the RECENT section needs besides the rows: `home` to shorten paths to `~`, `now` to say "2h ago". */
export interface RecentSection {
  rows: RecentRow[];
  home: string;
  now: number;
}

/**
 * The RECENT section under the Profile table (issue recent-directories/01,
 * K4): path, Profile, how long ago, and a `≠binding` mark. The cursor moves
 * through the Profiles and these rows as one list, so `selectedIndex` here is
 * already offset past the Profiles — negative means a Profile is selected.
 * No rows, no section: not even the heading.
 */
function renderRecentSection(recent: RecentSection, selectedIndex: number): string[] {
  if (recent.rows.length === 0) {
    return [];
  }

  const paths = recent.rows.map((row) => shortenHome(row.dir, recent.home));
  const pathWidth = Math.max(7, ...paths.map((p) => p.length));
  const profileWidth = Math.max(7, ...recent.rows.map((row) => row.profile.length));

  const lines = recent.rows.map((row, index) => {
    const isSelected = index === selectedIndex;
    const cursor = isSelected ? "> " : "  ";
    const mark = row.bindingConflict ? "≠binding" : "";
    const line = `${cursor}${pad(paths[index]!, pathWidth)}  ${pad(row.profile, profileWidth)}  ${pad(formatAgo(recent.now - row.lastUsed), 9)}  ${mark}`.trimEnd();
    return isSelected ? `${BOLD}${CYAN}${line}${RESET}` : line;
  });

  return ["", `  ${DIM}RECENT${RESET}`, ...lines];
}

/** `~` for the home directory, so a row fits the terminal. Case-insensitive on Windows, where paths are. */
function shortenHome(dir: string, home: string): string {
  const fold = (text: string) => (process.platform === "win32" ? text.toLowerCase() : text);
  if (fold(dir) === fold(home)) {
    return "~";
  }
  const homePrefix = home.endsWith(path.sep) ? home : home + path.sep;
  if (fold(dir).startsWith(fold(homePrefix))) {
    return path.join("~", dir.slice(homePrefix.length));
  }
  return dir;
}

/**
 * Renders the add screen (spec §10.6): a single name prompt and nothing else —
 * there is deliberately no `--bind` equivalent here, that stays with the `bind`
 * command. `error` is the message from the same validation and conflict rules
 * the flag-based `add` uses (§6.1/§6.3); showing it in place is what keeps the
 * flow alive instead of dropping the user back to the list. Pure and
 * TTY-independent, like `renderProfileList`.
 */
export function renderAddScreen(draftName: string, error: string | undefined): string {
  const lines = [`${BOLD}new profile${RESET}`, "", `  name: ${draftName}${CYAN}_${RESET}`];

  if (error !== undefined) {
    lines.push("", ...messageBlock(error, RED));
  }

  lines.push("", `${DIM}${ADD_FOOTER_HINT}${RESET}`);

  return lines.join("\n") + "\n";
}

/**
 * Renders the Remove confirmation (spec §10.7): the same one-line question the
 * flag-based `cswitch remove` asks, word for word, and no request to retype the
 * name — that is deliberate friction the spec rejects for daily use. `error` is
 * a message from `removeProfile()` itself, shown in place rather than dropping
 * the user back to the list with no explanation. Pure and TTY-independent, like
 * the other screens.
 */
export function renderRemoveScreen(name: string, error: string | undefined): string {
  const lines = [`${BOLD}delete ${name}? this cannot be undone (y/n)${RESET}`];

  if (error !== undefined) {
    lines.push("", ...messageBlock(error, RED));
  }

  lines.push("", `${DIM}${REMOVE_FOOTER_HINT}${RESET}`);

  return lines.join("\n") + "\n";
}
