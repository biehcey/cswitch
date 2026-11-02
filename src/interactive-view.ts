import path from "node:path";
import type { AccountDisplay } from "./account.js";
import { formatAgo, shortenHome, type RecentRow } from "./recent.js";
import { LAUNCH_ACTIONS } from "./interactive-actions.js";
import type { ProfileStatus } from "./status.js";

// Raw ANSI SGR codes (spec §10.2): color is a deliberate exception to `status`'s
// colorless output, and no third-party package is introduced for it (spec §7).
const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const CYAN = "\x1b[36m";
const DIM = "\x1b[2m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";

// One color per Profile, by its place in the list, so the dot on a Profile row
// and on every Recent row of that Profile match at a glance. Red and yellow are
// left out — they mean "something is wrong" on this screen.
const PROFILE_COLORS = ["\x1b[35m", "\x1b[34m", "\x1b[32m", "\x1b[36m", "\x1b[95m", "\x1b[94m", "\x1b[92m", "\x1b[96m"];
const DOT = "●";

export const CLEAR_SCREEN = "\x1b[2J\x1b[H";

// Every screen draws its own caret where one belongs (the add screen's `_`), so
// the terminal's real cursor is nothing but a stray block parked under the table
// on a keypress-driven screen. It is hidden for the whole session and restored
// on every exit path — Ctrl-C included — because a terminal left with an
// invisible cursor is as unusable as one left in raw mode (spec §10.3).
export const HIDE_CURSOR = "\x1b[?25l";
export const SHOW_CURSOR = "\x1b[?25h";

// Built from LAUNCH_ACTIONS rather than written out, so the footer and the keys
// `interactive.ts` actually dispatches can never drift apart (spec §10.3).
const LAUNCH_HINTS = LAUNCH_ACTIONS.map((action) => `${action.key} ${action.label}`);

export const LIST_FOOTER_HINT = ["↑↓ move", "enter run", ...LAUNCH_HINTS, "a add", "d remove", "esc quit"].join(" · ");

// The same keys minus `d`, which does nothing on a Recent Directory row (issue
// recent-directories/01, K5) and so must not be advertised there.
export const RECENT_FOOTER_HINT = ["↑↓ move", "enter run", ...LAUNCH_HINTS, "a add", "esc quit"].join(" · ");

export const ADD_FOOTER_HINT = "enter create · esc cancel";

export const REMOVE_FOOTER_HINT = "y remove · n/esc cancel";

function pad(text: string, width: number): string {
  return text.length >= width ? text : text + " ".repeat(width - text.length);
}

/** Indents a possibly multi-line message and colors every line of it, so a message
 * that wraps stays visibly one block rather than trailing off uncolored. */
function messageBlock(text: string, color: string): string[] {
  return text.split("\n").map((line) => `  ${color}${line}${RESET}`);
}

/**
 * Builds one list row. A selected row is drawn whole in bold cyan, so its parts
 * keep only the dot's color — an inner RESET would cut the outer highlight
 * short; an unselected row gives each part its own style instead.
 */
class RowBuilder {
  private text = "";

  constructor(private readonly selected: boolean) {
    this.text = selected ? "> " : "  ";
  }

  plain(part: string): this {
    this.text += part;
    return this;
  }

  styled(part: string, style: string): this {
    if (part.trim() === "") {
      this.text += part;
      return this;
    }
    this.text += this.selected || style === "" ? part : `${style}${part}${RESET}`;
    return this;
  }

  dot(color: string): this {
    this.text += this.selected ? `${color}${DOT}${CYAN}` : `${color}${DOT}${RESET}`;
    return this;
  }

  build(): string {
    // Trailing padding is invisible but would break "ends with" reads of a row;
    // it can sit just before a closing RESET, so look past color codes too.
    let line = this.text;
    for (let previous = ""; previous !== line; ) {
      previous = line;
      // eslint-disable-next-line no-control-regex
      line = line.replace(/ +((?:\x1b\[[0-9;]*m)*)$/, "$1");
    }
    return this.selected ? `${BOLD}${CYAN}${line}${RESET}` : line;
  }
}

/**
 * The Account as the list shows it: like `formatAccount`, but an organization
 * name that only restates the email (`a@b.com's Organization`, what a personal
 * account gets) is dropped as noise. Not logged in / unknown come back with the
 * color that flags them — the only Login State this screen shows (a logged-in
 * Profile is the normal case and says nothing).
 */
function accountCell(account: AccountDisplay): { text: string; style: string } {
  switch (account.kind) {
    case "not-logged-in":
      return { text: "(not logged in)", style: RED };
    case "unknown":
      return { text: "(account unknown)", style: YELLOW };
    case "known": {
      const org = account.organizationName;
      const redundant = org === undefined || org === "" || org === `${account.emailAddress}'s Organization`;
      return { text: redundant ? account.emailAddress : `${account.emailAddress} · ${org}`, style: "" };
    }
  }
}

function profileColor(profiles: ProfileStatus[], name: string): string {
  const index = profiles.findIndex((p) => p.name === name);
  return PROFILE_COLORS[(index < 0 ? 0 : index) % PROFILE_COLORS.length]!;
}

/**
 * Renders the Profile list (spec §10.5): a title, the Profiles — colored dot,
 * name, Account, `default` on the Default Profile — the RECENT section, and a
 * fixed key-hint footer (spec §10.2). Pure and TTY-independent so it can be
 * unit tested without a real terminal; the caller is responsible for clearing
 * the screen (`CLEAR_SCREEN`) before writing this. `notice` carries a message
 * that outlived the screen that produced it — a best-effort Keychain or
 * directory-delete warning from `removeProfile()` (§6.4/§10.9), which the
 * redraw after a deletion would otherwise wipe; the flag-based `remove` writes
 * the same text to stderr.
 */
export function renderProfileList(profiles: ProfileStatus[], selectedIndex: number, notice?: string, recent?: RecentSection): string {
  const accounts = profiles.map((p) => accountCell(p.account));
  const nameWidth = Math.max(0, ...profiles.map((p) => p.name.length));
  const accountWidth = Math.max(0, ...accounts.map((a) => a.text.length));

  const rows = profiles.map((profile, index) => {
    const account = accounts[index]!;
    return new RowBuilder(index === selectedIndex)
      .dot(profileColor(profiles, profile.name))
      .plain(` ${pad(profile.name, nameWidth)}   `)
      .styled(pad(account.text, accountWidth), account.style)
      .plain("   ")
      .styled(profile.inPlace ? "default" : "", DIM)
      .build();
  });

  const recentSelected = recent !== undefined && recent.rows[selectedIndex - profiles.length] !== undefined;
  const footerHint = recentSelected ? RECENT_FOOTER_HINT : LIST_FOOTER_HINT;
  const footer = `  ${DIM}${footerHint}${RESET}`;

  const noticeLines = notice === undefined ? [] : ["", ...messageBlock(notice, YELLOW)];

  const recentLines = recent === undefined ? [] : renderRecentSection(recent, profiles, selectedIndex - profiles.length);

  const title = `  ${BOLD}cswitch${RESET}`;
  const heading = `  ${DIM}PROFILES${RESET}`;

  return [title, "", heading, ...rows, ...recentLines, ...noticeLines, "", footer].join("\n") + "\n";
}

/** Everything the RECENT section needs besides the rows: `home` to shorten paths to `~`, `now` to say "2h ago". */
export interface RecentSection {
  rows: RecentRow[];
  home: string;
  now: number;
}

/**
 * Splits a Recent Directory into what the eye looks for — the folder's own name
 * — and where it lives, `~`-shortened. The home directory itself is `~` with no
 * parent; a drive or filesystem root is its own name.
 */
function folderAndParent(dir: string, home: string): { folder: string; parent: string } {
  const shortened = shortenHome(dir, home);
  if (shortened === "~") {
    return { folder: "~", parent: "" };
  }
  const parentDir = path.dirname(dir);
  if (parentDir === dir) {
    return { folder: dir, parent: "" };
  }
  return { folder: path.basename(dir), parent: shortenHome(parentDir, home) };
}

/**
 * The RECENT section under the Profiles (issue recent-directories/01, K4):
 * folder name, the Profile's dot and name, how long ago, a `≠binding` mark when
 * any row needs one, and the parent path last and dim. The cursor moves through
 * the Profiles and these rows as one list, so `selectedIndex` here is already
 * offset past the Profiles — negative means a Profile is selected. No rows, no
 * section: not even the heading.
 */
function renderRecentSection(recent: RecentSection, profiles: ProfileStatus[], selectedIndex: number): string[] {
  if (recent.rows.length === 0) {
    return [];
  }

  const parts = recent.rows.map((row) => folderAndParent(row.dir, recent.home));
  const ages = recent.rows.map((row) => formatAgo(recent.now - row.lastUsed));
  const folderWidth = Math.max(0, ...parts.map((p) => p.folder.length));
  const profileWidth = Math.max(0, ...recent.rows.map((row) => row.profile.length));
  const ageWidth = Math.max(0, ...ages.map((a) => a.length));
  const anyConflict = recent.rows.some((row) => row.bindingConflict);

  const lines = recent.rows.map((row, index) => {
    const builder = new RowBuilder(index === selectedIndex)
      .styled(pad(parts[index]!.folder, folderWidth), BOLD)
      .plain("   ")
      .dot(profileColor(profiles, row.profile))
      .plain(` ${pad(row.profile, profileWidth)}   ${pad(ages[index]!, ageWidth)}   `);
    if (anyConflict) {
      builder.styled(pad(row.bindingConflict ? "≠binding" : "", 8), YELLOW).plain("   ");
    }
    return builder.styled(parts[index]!.parent, DIM).build();
  });

  return ["", `  ${DIM}RECENT${RESET}`, ...lines];
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
