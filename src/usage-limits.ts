import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { ProfileRecord } from "./config.js";
import { keychainAccountName, keychainServiceName } from "./keychain.js";
import { profileConfigDir } from "./launch.js";

/**
 * Usage Limits: how full an Account's 5-hour and weekly Claude subscription
 * windows are — the numbers Claude Code's `/usage` shows. See
 * docs/adr/0003-usage-limits.md for why cswitch reads an Account's token and
 * calls Anthropic at all, and the rules that keep that safe:
 *
 * - read-only: the token is used as-is and never refreshed or written back, so
 *   cswitch can never invalidate the credentials Claude Code itself holds;
 * - best-effort: any failure (no token, expired, offline, a changed endpoint)
 *   means "show nothing", never an error on the list;
 * - opt-out with `CSWITCH_NO_USAGE=1`.
 */
export interface UsageLimits {
  fiveHour?: UsageWindow;
  weekly?: UsageWindow;
}

/** One limit window: how full it is and, when known, when it resets. Held in memory only. */
export interface UsageWindow {
  percent: number;
  /** Epoch ms. */
  resetsAt?: number;
}

// UNVERIFIED: undocumented — the endpoint Claude Code's `/usage` calls.
export const USAGE_URL = "https://api.anthropic.com/api/oauth/usage";
const USAGE_TIMEOUT_MS = 3000;

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

/** Runs `/usr/bin/security` with these args and returns its stdout, or undefined on any failure. Injectable for tests. */
export type ReadKeychain = (args: string[]) => string | undefined;

export function defaultReadKeychain(args: string[]): string | undefined {
  const result = spawnSync("/usr/bin/security", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 2000 });
  return result.status === 0 ? result.stdout : undefined;
}

export function usageLimitsDisabled(env: NodeJS.ProcessEnv): boolean {
  return (env.CSWITCH_NO_USAGE ?? "") !== "";
}

/**
 * The macOS Keychain service holding a config dir's credentials. Claude Code's
 * own `~/.claude` (the in-place Profile) uses the bare name; any other config
 * dir gets the hashed suffix `keychainServiceName` guesses (UNVERIFIED, see keychain.ts).
 */
export function credentialsServiceName(configDir: string, inPlace: boolean): string {
  return inPlace ? "Claude Code-credentials" : keychainServiceName(configDir);
}

export interface ReadAccessTokenParams {
  configDir: string;
  inPlace: boolean;
  platform: NodeJS.Platform;
  now: number;
  readKeychain?: ReadKeychain;
}

/**
 * The Account's OAuth access token if one is stored and still live, else
 * undefined. Never throws. macOS keeps it in the Keychain; Windows and Linux
 * in `<configDir>/.credentials.json`. Both hold the same JSON.
 */
export function readAccessToken(params: ReadAccessTokenParams): string | undefined {
  const { configDir, inPlace, platform, now, readKeychain = defaultReadKeychain } = params;

  let raw: string | undefined;
  if (platform === "darwin") {
    raw = readKeychain(["find-generic-password", "-s", credentialsServiceName(configDir, inPlace), "-a", keychainAccountName(), "-w"]);
  } else {
    try {
      raw = readFileSync(path.join(configDir, ".credentials.json"), "utf8");
    } catch {
      raw = undefined;
    }
  }
  if (raw === undefined) {
    return undefined;
  }

  try {
    const oauth = (JSON.parse(raw) as { claudeAiOauth?: { accessToken?: unknown; expiresAt?: unknown } }).claudeAiOauth;
    if (typeof oauth?.accessToken !== "string" || oauth.accessToken === "") {
      return undefined;
    }
    // An expired token would only earn a 401; refreshing it is Claude Code's job, not ours.
    if (typeof oauth.expiresAt === "number" && oauth.expiresAt <= now) {
      return undefined;
    }
    return oauth.accessToken;
  } catch {
    return undefined;
  }
}

// Only the shape the endpoint really sends (`2026-11-03T10:50:00.083387+00:00`):
// Date.parse alone is lenient and would read "foo 2030" as a year.
const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

/** `resets_at` as epoch ms; undefined if missing or not an ISO 8601 date-time. */
function parseResetsAt(resetsAt: unknown): number | undefined {
  if (typeof resetsAt !== "string" || !ISO_DATE_TIME.test(resetsAt)) {
    return undefined;
  }
  const ms = Date.parse(resetsAt);
  return Number.isFinite(ms) ? ms : undefined;
}

/** One window out of the endpoint's JSON; undefined without a usable `utilization`. A bad `resets_at` only drops the reset time. */
function parseWindow(window: unknown): UsageWindow | undefined {
  if (window === null || typeof window !== "object") {
    return undefined;
  }
  const { utilization, resets_at } = window as { utilization?: unknown; resets_at?: unknown };
  if (typeof utilization !== "number" || !Number.isFinite(utilization)) {
    return undefined;
  }
  const resetsAt = parseResetsAt(resets_at);
  return resetsAt === undefined ? { percent: Math.round(utilization) } : { percent: Math.round(utilization), resetsAt };
}

/** Picks the 5-hour and weekly windows out of the endpoint's JSON; undefined if neither is there. */
export function parseUsageLimits(body: unknown): UsageLimits | undefined {
  if (body === null || typeof body !== "object") {
    return undefined;
  }
  const data = body as { five_hour?: unknown; seven_day?: unknown };
  const fiveHour = parseWindow(data.five_hour);
  const weekly = parseWindow(data.seven_day);
  if (fiveHour === undefined && weekly === undefined) {
    return undefined;
  }
  const limits: UsageLimits = {};
  if (fiveHour !== undefined) limits.fiveHour = fiveHour;
  if (weekly !== undefined) limits.weekly = weekly;
  return limits;
}

/** One GET to the usage endpoint with this token. Never rejects: any failure is undefined. */
export async function fetchUsageLimits(token: string, fetchImpl: FetchLike = fetch): Promise<UsageLimits | undefined> {
  try {
    const response = await fetchImpl(USAGE_URL, {
      headers: { Authorization: `Bearer ${token}`, "anthropic-beta": "oauth-2025-04-20" },
      signal: AbortSignal.timeout(USAGE_TIMEOUT_MS),
    });
    if (!response.ok) {
      return undefined;
    }
    return parseUsageLimits(await response.json());
  } catch {
    return undefined;
  }
}

/**
 * How long until a window resets, in its two biggest units, rounded down:
 * `3d 13h`, `1h 20m`, `45m`, `<1m`; a zero second unit is dropped (`2h`).
 * Undefined when there's no reset time or it's already past — the percent
 * alone then, rather than a countdown that's wrong.
 */
function timeUntilReset(resetsAt: number | undefined, now: number): string | undefined {
  if (resetsAt === undefined || resetsAt <= now) {
    return undefined;
  }
  const totalMinutes = Math.floor((resetsAt - now) / 60_000);
  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor(totalMinutes / 60) % 24;
  const minutes = totalMinutes % 60;
  if (days > 0) {
    return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  }
  if (hours > 0) {
    return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  }
  return minutes > 0 ? `${minutes}m` : "<1m";
}

/** One window as the row shows it: `5h 91% (1h 20m)`, or `5h 91%` with no upcoming reset time. */
function formatWindow(label: string, window: UsageWindow, now: number): string {
  const resetIn = timeUntilReset(window.resetsAt, now);
  return resetIn === undefined ? `${label} ${window.percent}%` : `${label} ${window.percent}% (${resetIn})`;
}

/** The list row's short form: `5h 37% (1h 20m) · week 7% (3d 13h)`, the reset times counted from `now`. */
export function formatUsageLimits(limits: UsageLimits, now: number): string {
  const parts: string[] = [];
  if (limits.fiveHour !== undefined) parts.push(formatWindow("5h", limits.fiveHour, now));
  if (limits.weekly !== undefined) parts.push(formatWindow("week", limits.weekly, now));
  return parts.join(" · ");
}

/** The fullest window's percent — what decides whether the row should warn. */
export function highestPercent(limits: UsageLimits): number {
  return Math.max(limits.fiveHour?.percent ?? 0, limits.weekly?.percent ?? 0);
}

export interface LoadUsageLimitsParams {
  home: string;
  cswitchHome: string;
  record: ProfileRecord;
  env: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  now?: number;
  fetchImpl?: FetchLike;
  readKeychain?: ReadKeychain;
}

/**
 * One Profile's Usage Limits, start to finish: opt-out check, its config dir
 * (`~/.claude` for the in-place Profile), its live token, one request.
 * Undefined at the first step that has nothing — no request is made without a token.
 */
export async function loadUsageLimits(params: LoadUsageLimitsParams): Promise<UsageLimits | undefined> {
  const { home, cswitchHome, record, env, platform = process.platform, now = Date.now(), fetchImpl, readKeychain } = params;
  if (usageLimitsDisabled(env)) {
    return undefined;
  }
  const configDir = profileConfigDir(cswitchHome, record) ?? path.join(home, ".claude");
  const token = readAccessToken({ configDir, inPlace: record.inPlace === true, platform, now, readKeychain });
  if (token === undefined) {
    return undefined;
  }
  return fetchUsageLimits(token, fetchImpl);
}
