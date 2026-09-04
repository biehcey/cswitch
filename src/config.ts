import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export interface ProfileRecord {
  name: string;
  inPlace?: true;
}

export interface Binding {
  prefix: string;
  profile: string;
}

export interface Config {
  version: 1;
  profiles: ProfileRecord[];
  bindings: Binding[];
}

export class ConfigError extends Error {}

export function cswitchHomePath(home: string): string {
  return path.join(home, ".cswitch");
}

export function configPath(cswitchHome: string): string {
  return path.join(cswitchHome, "config.json");
}

export function settingsPath(cswitchHome: string): string {
  return path.join(cswitchHome, "settings.json");
}

export function profilesDirPath(cswitchHome: string): string {
  return path.join(cswitchHome, "profiles");
}

/**
 * Reads and validates `config.json`. Returns undefined if the file does not
 * exist yet (a fresh machine); throws ConfigError for any other read/parse/
 * schema failure (spec §3.1: schema errors are a hard failure, exit 70).
 */
export function readConfig(cswitchHome: string): Config | undefined {
  let raw: string;
  try {
    raw = readFileSync(configPath(cswitchHome), "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }
    throw new ConfigError(`cswitch: could not read ~/.cswitch/config.json: ${(err as Error).message}`);
  }

  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new ConfigError("cswitch: ~/.cswitch/config.json is not valid JSON");
  }

  if (!isValidConfig(data)) {
    throw new ConfigError("cswitch: ~/.cswitch/config.json has an invalid schema");
  }

  return data;
}

function isValidConfig(data: unknown): data is Config {
  if (typeof data !== "object" || data === null) {
    return false;
  }
  const record = data as Record<string, unknown>;
  if (typeof record.version !== "number") {
    return false;
  }
  if (!Array.isArray(record.profiles) || !record.profiles.every(isValidProfileRecord)) {
    return false;
  }
  if (!Array.isArray(record.bindings) || !record.bindings.every(isValidBinding)) {
    return false;
  }
  const inPlaceCount = record.profiles.filter((p: ProfileRecord) => p.inPlace === true).length;
  if (inPlaceCount > 1) {
    return false;
  }
  return true;
}

function isValidProfileRecord(value: unknown): value is ProfileRecord {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.name !== "string" || record.name.length === 0) {
    return false;
  }
  if (record.inPlace !== undefined && record.inPlace !== true) {
    return false;
  }
  return true;
}

function isValidBinding(value: unknown): value is Binding {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return typeof record.prefix === "string" && typeof record.profile === "string";
}

export function writeConfig(cswitchHome: string, config: Config): void {
  writeFileSync(configPath(cswitchHome), `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

/** Creates `~/.cswitch/` and `~/.cswitch/profiles/` if missing. Returns whether it created anything. */
export function ensureCswitchTree(cswitchHome: string): { createdHome: boolean; createdProfilesDir: boolean } {
  const createdHome = !existsSync(cswitchHome);
  const createdProfilesDir = !existsSync(profilesDirPath(cswitchHome));
  if (createdProfilesDir) {
    // profiles/ is nested under cswitchHome, so this also creates cswitchHome when it's missing.
    mkdirSync(profilesDirPath(cswitchHome), { recursive: true });
  }
  return { createdHome, createdProfilesDir };
}

/** Creates the shared `settings.json` as `{}` if missing. Returns whether it wrote the file. */
export function ensureSharedSettings(cswitchHome: string): boolean {
  const target = settingsPath(cswitchHome);
  if (existsSync(target)) {
    return false;
  }
  writeFileSync(target, "{}\n", "utf8");
  return true;
}
