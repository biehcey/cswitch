import { formatAccount } from "./account.js";
import type { ProfileStatus } from "./status.js";
import { loginStateOf } from "./status.js";

// Raw ANSI SGR codes (spec §10.2): color is a deliberate exception to `status`'s
// colorless output, and no third-party package is introduced for it (spec §7).
const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const CYAN = "\x1b[36m";
const DIM = "\x1b[2m";
const GREEN = "\x1b[32m";

export const CLEAR_SCREEN = "\x1b[2J\x1b[H";

export const LIST_FOOTER_HINT = "[enter] run   [esc] quit";

function pad(text: string, width: number): string {
  return text.length >= width ? text : text + " ".repeat(width - text.length);
}

function loginStateColor(state: ReturnType<typeof loginStateOf>): string {
  return state === "logged-in" ? GREEN : "";
}

/**
 * Renders the Profile list (spec §10.5) as a Dense table — name, Account, Login
 * State, Default marker — with a fixed key-hint footer (spec §10.2). Pure and
 * TTY-independent so it can be unit tested without a real terminal; the caller
 * is responsible for clearing the screen (`CLEAR_SCREEN`) before writing this.
 */
export function renderProfileList(profiles: ProfileStatus[], selectedIndex: number): string {
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

  return [header, ...rows, "", footer].join("\n") + "\n";
}
