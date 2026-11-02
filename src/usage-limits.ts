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
  fiveHourPercent?: number;
  weeklyPercent?: number;
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

function windowPercent(window: unknown): number | undefined {
  if (window === null || typeof window !== "object") {
    return undefined;
  }
  const utilization = (window as { utilization?: unknown }).utilization;
  return typeof utilization === "number" && Number.isFinite(utilization) ? Math.round(utilization) : undefined;
}

/** Picks the 5-hour and weekly windows out of the endpoint's JSON; undefined if neither is there. */
export function parseUsageLimits(body: unknown): UsageLimits | undefined {
  if (body === null || typeof body !== "object") {
    return undefined;
  }
  const data = body as { five_hour?: unknown; seven_day?: unknown };
  const limits: UsageLimits = {};
  const fiveHour = windowPercent(data.five_hour);
  const weekly = windowPercent(data.seven_day);
  if (fiveHour !== undefined) limits.fiveHourPercent = fiveHour;
  if (weekly !== undefined) limits.weeklyPercent = weekly;
  return fiveHour === undefined && weekly === undefined ? undefined : limits;
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

/** The list row's short form: `5h 37% · week 7%`. */
export function formatUsageLimits(limits: UsageLimits): string {
  const parts: string[] = [];
  if (limits.fiveHourPercent !== undefined) parts.push(`5h ${limits.fiveHourPercent}%`);
  if (limits.weeklyPercent !== undefined) parts.push(`week ${limits.weeklyPercent}%`);
  return parts.join(" · ");
}

/** The fullest window's percent — what decides whether the row should warn. */
export function highestPercent(limits: UsageLimits): number {
  return Math.max(limits.fiveHourPercent ?? 0, limits.weeklyPercent ?? 0);
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
