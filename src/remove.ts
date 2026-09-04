import { rmSync } from "node:fs";
import path from "node:path";
import { ConfigError, cswitchHomePath, profilesDirPath, readConfig, writeConfig, type Config } from "./config.js";
import { EXIT_OK, EXIT_RUNTIME, EXIT_USAGE } from "./exit-codes.js";
import type { Io } from "./io.js";
import { deleteKeychainEntry, defaultSpawnSecurity, type SpawnSecurity } from "./keychain.js";

export interface RemoveProfileParams {
  home: string;
  name: string;
  platform?: NodeJS.Platform;
  spawnSecurity?: SpawnSecurity;
}

export type RemoveProfileResult =
  | { kind: "ok"; warning?: string }
  | { kind: "error"; exitCode: number; message: string };

type LoadResult =
  | { kind: "ok"; cswitchHome: string; config: Config }
  | { kind: "error"; result: RemoveProfileResult & { kind: "error" } };

/** Reads config.json and validates `name` is a real, non-default profile — the one
 * check both `removeProfile()` and its caller's pre-confirmation gate rely on, so
 * neither can drift out of sync with the other. */
function loadAndValidate(home: string, name: string): LoadResult {
  const cswitchHome = cswitchHomePath(home);

  let config: Config | undefined;
  try {
    config = readConfig(cswitchHome);
  } catch (err) {
    return { kind: "error", result: { kind: "error", exitCode: EXIT_RUNTIME, message: (err as ConfigError).message } };
  }

  if (config === undefined) {
    return {
      kind: "error",
      result: {
        kind: "error",
        exitCode: EXIT_RUNTIME,
        message: 'cswitch: ~/.cswitch not found. Run "cswitch init" first.',
      },
    };
  }

  const profile = config.profiles.find((p) => p.name === name);
  if (!profile) {
    return {
      kind: "error",
      result: {
        kind: "error",
        exitCode: EXIT_RUNTIME,
        message: `cswitch: no profile named "${name}" in ~/.cswitch/config.json`,
      },
    };
  }

  if (profile.inPlace === true) {
    return {
      kind: "error",
      result: {
        kind: "error",
        exitCode: EXIT_RUNTIME,
        message: `cswitch: "${name}" is the default profile and cannot be removed — delete ~/.cswitch entirely instead`,
      },
    };
  }

  return { kind: "ok", cswitchHome, config };
}

/**
 * The single code path `cswitch remove` and Interactive Mode's Remove screen both call
 * (spec §6.4) — no confirmation here, that's each caller's own concern. Order is `add`'s
 * chain reversed: config record out, then Bindings pointing at it, then (macOS only)
 * a best-effort Keychain cleanup, then — last, because it's the irreversible step — the
 * physical profile directory (spec §10.9). Record removal and Binding cleanup are
 * computed in memory and land as one atomic config.json write; if that write fails,
 * neither the Keychain nor the directory is ever touched. A Keychain failure never
 * stops the removal — it's reported as a warning and physical deletion proceeds
 * regardless. If the directory delete itself fails (already committed config.json is
 * the source of truth by that point), the removal is still reported as done, with a
 * warning attached; a Keychain warning and a directory-delete warning both surface,
 * one per line.
 */
export function removeProfile(params: RemoveProfileParams): RemoveProfileResult {
  const { home, name, platform = process.platform, spawnSecurity = defaultSpawnSecurity } = params;
  const loaded = loadAndValidate(home, name);
  if (loaded.kind === "error") {
    return loaded.result;
  }
  const { cswitchHome, config } = loaded;

  const nextProfiles = config.profiles.filter((p) => p.name !== name);
  const nextBindings = config.bindings.filter((b) => b.profile !== name);
  writeConfig(cswitchHome, { ...config, profiles: nextProfiles, bindings: nextBindings });

  const warnings: string[] = [];

  if (platform === "darwin") {
    const configDir = path.join(profilesDirPath(cswitchHome), name);
    const keychainResult = deleteKeychainEntry(configDir, spawnSecurity);
    if (keychainResult.kind === "warning") {
      warnings.push(keychainResult.message);
    }
  }

  try {
    rmSync(path.join(profilesDirPath(cswitchHome), name), { recursive: true, force: true });
  } catch (err) {
    warnings.push(`cswitch: removed "${name}" from config, but could not delete its directory: ${(err as Error).message}`);
  }

  return warnings.length > 0 ? { kind: "ok", warning: warnings.join("\n") } : { kind: "ok" };
}

export interface RunRemoveParams {
  home: string;
  name: string;
  force: boolean;
  io: Io;
}

/**
 * `cswitch remove <name> [--force]` (spec §6.4): validates the name is a real,
 * non-default profile first (so a bad name never gets a scary confirmation prompt),
 * then resolves the confirmation gate — a TTY is asked `delete <name>? this cannot be
 * undone`, no TTY requires `--force` — then delegates the entire deletion to
 * `removeProfile()`.
 */
export async function runRemove(params: RunRemoveParams): Promise<number> {
  const { home, name, force, io } = params;

  const loaded = loadAndValidate(home, name);
  if (loaded.kind === "error") {
    process.stderr.write(`${loaded.result.message}\n`);
    return loaded.result.exitCode;
  }

  if (!force) {
    if (!io.isTTY) {
      process.stderr.write("cswitch: refusing to remove without confirmation — pass --force\n");
      return EXIT_USAGE;
    }
    const answer = (await io.question(`delete ${name}? this cannot be undone (y/n) `)).trim().toLowerCase();
    if (answer !== "y" && answer !== "yes") {
      io.write("Aborted.\n");
      return EXIT_OK;
    }
  }

  const result = removeProfile({ home, name });
  if (result.kind === "error") {
    process.stderr.write(`${result.message}\n`);
    return result.exitCode;
  }

  if (result.warning !== undefined) {
    process.stderr.write(`${result.warning}\n`);
  }

  io.write(`  ✓ removed "${name}"\n`);
  return EXIT_OK;
}
