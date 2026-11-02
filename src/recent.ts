import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { ConfigError, cswitchHomePath, profilesDirPath, readConfig, type Config, type ProfileRecord } from "./config.js";
import { EXIT_OK, EXIT_RUNTIME } from "./exit-codes.js";
import { resolveCwdBinding } from "./launch.js";

/**
 * A Recent Directory (CONTEXT.md): one (directory, Profile) pair the user has
 * run Claude Code in, with the last time they did.
 */
export interface RecentDirectory {
  dir: string;
  profile: string;
  /** Milliseconds since the epoch, as Claude Code writes it to history.jsonl. */
  lastUsed: number;
}

export interface ListRecentDirectoriesParams {
  home: string;
  cswitchHome: string;
  config: Config;
  platform?: NodeJS.Platform;
}

/** Where Claude Code keeps this Profile's prompt history — the Default Profile keeps `~/.claude`'s. */
function historyPath(home: string, cswitchHome: string, record: ProfileRecord): string {
  const configDir = record.inPlace ? path.join(home, ".claude") : path.join(profilesDirPath(cswitchHome), record.name);
  return path.join(configDir, "history.jsonl");
}

interface HistoryEntry {
  project: string;
  timestamp: number;
}

/**
 * Reads the (project, timestamp) pairs out of one history.jsonl. The file is
 * Claude Code's internal format, not a contract with us (issue K3): a missing
 * file, a line that isn't JSON, or a line without a string `project` and a
 * numeric `timestamp` is skipped, never reported — Interactive Mode must not
 * fail because Claude Code changed its history format.
 */
function readHistory(file: string): HistoryEntry[] {
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return [];
  }

  const entries: HistoryEntry[] = [];
  for (const line of text.split("\n")) {
    if (line.trim() === "") {
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    if (typeof parsed !== "object" || parsed === null) {
      continue;
    }
    const { project, timestamp } = parsed as Record<string, unknown>;
    // A relative path would be resolved against cswitch's own cwd, not the
    // directory the user worked in, so it is as unusable as a missing one.
    if (typeof project === "string" && path.isAbsolute(project) && typeof timestamp === "number") {
      entries.push({ project, timestamp });
    }
  }
  return entries;
}

/** How many rows the list shows (issue K2). */
const RECENT_LIMIT = 10;

/**
 * Builds the Recent Directory list from every Profile's `history.jsonl`
 * (issue recent-directories/01, K2): one row per (directory, Profile), stamped
 * with its newest entry, newest first.
 */
export function listRecentDirectories(params: ListRecentDirectoriesParams): RecentDirectory[] {
  const { home, cswitchHome, config } = params;
  const platform = params.platform ?? process.platform;
  const rows = new Map<string, RecentDirectory>();

  for (const record of config.profiles) {
    for (const entry of readHistory(historyPath(home, cswitchHome, record))) {
      const key = `${record.name}\0${pathKey(entry.project, platform)}`;
      const existing = rows.get(key);
      if (existing === undefined || entry.timestamp > existing.lastUsed) {
        rows.set(key, { dir: entry.project, profile: record.name, lastUsed: entry.timestamp });
      }
    }
  }

  return [...rows.values()]
    .sort((a, b) => b.lastUsed - a.lastUsed)
    .filter((row) => isDirectory(row.dir))
    .slice(0, RECENT_LIMIT);
}

/**
 * A path in the form two spellings of the same directory share. Windows paths
 * are case-insensitive, and Claude Code records whatever spelling the shell
 * had (`C:\` vs `c:\`) — those are one directory.
 */
function pathKey(dir: string, platform: NodeJS.Platform): string {
  return platform === "win32" ? dir.toLowerCase() : dir;
}

/** `~` for the home directory, so a row fits the terminal (issue K4). */
export function shortenHome(dir: string, home: string, platform: NodeJS.Platform = process.platform): string {
  if (pathKey(dir, platform) === pathKey(home, platform)) {
    return "~";
  }
  const homePrefix = home.endsWith(path.sep) ? home : home + path.sep;
  if (pathKey(dir, platform).startsWith(pathKey(homePrefix, platform))) {
    return path.join("~", dir.slice(homePrefix.length));
  }
  return dir;
}

function isDirectory(dir: string): boolean {
  try {
    return statSync(dir).isDirectory();
  } catch {
    return false;
  }
}

/** A Recent Directory as it is shown: whether its directory's Binding names another Profile (ADR-0002). */
export interface RecentRow extends RecentDirectory {
  bindingConflict: boolean;
}

/**
 * The Recent Directory list, each row flagged when its directory's Binding
 * names a different, existing Profile — the row's Profile wins at launch, but
 * the user sees the disagreement (ADR-0002). A stale Binding to a Profile that
 * no longer exists would not win a launch either, so it is no conflict.
 */
export function listRecentRows(params: ListRecentDirectoriesParams): RecentRow[] {
  const { config } = params;
  return listRecentDirectories(params).map((row) => {
    const binding = resolveCwdBinding(config, undefined, row.dir, () => {});
    const bindingConflict =
      binding !== undefined && binding.profile !== row.profile && config.profiles.some((p) => p.name === binding.profile);
    return { ...row, bindingConflict };
  });
}

/**
 * Formats the list as `cswitch recent` prints it (issue K8): plain columns, no
 * color, full paths so a row can be copied straight into `cd`. No rows, no
 * output — not even a header — so an empty result is an empty stdout.
 */
export function formatRecentTable(rows: RecentRow[], now: number): string {
  if (rows.length === 0) {
    return "";
  }
  const pad = (text: string, width: number) => text + " ".repeat(Math.max(0, width - text.length));
  const dirWidth = Math.max(9, ...rows.map((row) => row.dir.length));
  const profileWidth = Math.max(7, ...rows.map((row) => row.profile.length));
  const header = `${pad("DIRECTORY", dirWidth)}  ${pad("PROFILE", profileWidth)}  LAST USED`;
  const lines = rows.map((row) => {
    const mark = row.bindingConflict ? "≠binding" : "";
    return `${pad(row.dir, dirWidth)}  ${pad(row.profile, profileWidth)}  ${pad(formatAgo(now - row.lastUsed), 9)}  ${mark}`.trimEnd();
  });
  return [header, ...lines].join("\n") + "\n";
}

/** "2h ago": how long ago a Recent Directory was last used, as both the list and `cswitch recent` show it. */
export function formatAgo(elapsedMs: number): string {
  const minutes = Math.floor(elapsedMs / 60_000);
  if (minutes < 1) {
    return "just now";
  }
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }
  return `${Math.floor(hours / 24)}d ago`;
}

export function runRecent(params: { home: string; now?: number }): number {
  const { home } = params;
  const cswitchHome = cswitchHomePath(home);

  let config: Config | undefined;
  try {
    config = readConfig(cswitchHome);
  } catch (err) {
    process.stderr.write(`${(err as ConfigError).message}\n`);
    return EXIT_RUNTIME;
  }
  if (config === undefined) {
    process.stderr.write('cswitch: ~/.cswitch not found. Run "cswitch init" first.\n');
    return EXIT_RUNTIME;
  }

  process.stdout.write(formatRecentTable(listRecentRows({ home, cswitchHome, config }), params.now ?? Date.now()));
  return EXIT_OK;
}
