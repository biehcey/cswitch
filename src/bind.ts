import { existsSync } from "node:fs";
import { canonicalizeDir, comparisonSegments, isSamePrefix, resolveBindingConflict, BindingPathError } from "./binding.js";
import { ConfigError, cswitchHomePath, readConfig, writeConfig, type Config } from "./config.js";
import { EXIT_OK, EXIT_RUNTIME, EXIT_USAGE } from "./exit-codes.js";
import type { Io } from "./io.js";

export interface RunBindParams {
  home: string;
  dir: string;
  profileName: string;
  force: boolean;
  io: Io;
}

/**
 * `cswitch bind <dir> <profile>` (spec §4.1, §6.5): canonicalizes `dir` and
 * records it, replacing any Binding already stored for the same canonical
 * prefix.
 */
export async function runBind(params: RunBindParams): Promise<number> {
  const { home, dir, profileName, force, io } = params;
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

  if (!config.profiles.some((p) => p.name === profileName)) {
    process.stderr.write(`cswitch: no profile named "${profileName}" in ~/.cswitch/config.json\n`);
    return EXIT_RUNTIME;
  }

  let canonicalDir: string;
  try {
    canonicalDir = canonicalizeDir(dir, home);
  } catch (err) {
    process.stderr.write(`${(err as BindingPathError).message}\n`);
    return EXIT_RUNTIME;
  }

  const conflict = await resolveBindingConflict({ bindings: config.bindings, canonicalDir, force, io });
  if (conflict.kind === "blocked") {
    process.stderr.write(`${conflict.message}\n`);
    return EXIT_USAGE;
  }
  if (conflict.kind === "aborted") {
    io.write("Aborted.\n");
    return EXIT_OK;
  }

  const nextBindings = [
    ...config.bindings.filter((b) => !isSamePrefix(b.prefix, canonicalDir)),
    { prefix: canonicalDir, profile: profileName },
  ];
  writeConfig(cswitchHome, { ...config, bindings: nextBindings });

  io.write(`  ✓ bound ${canonicalDir} to ${profileName}\n`);
  return EXIT_OK;
}

export interface RunBindListParams {
  home: string;
}

/** `cswitch bind --list` (spec §6.5): longest prefix first, missing directories flagged. */
export function runBindList(params: RunBindListParams): number {
  const { home } = params;
  const cswitchHome = cswitchHomePath(home);

  let config: Config | undefined;
  try {
    config = readConfig(cswitchHome);
  } catch (err) {
    process.stderr.write(`${(err as ConfigError).message}\n`);
    return EXIT_RUNTIME;
  }

  if (config === undefined || config.bindings.length === 0) {
    process.stdout.write("(no bindings)\n");
    return EXIT_OK;
  }

  const sorted = [...config.bindings].sort(
    (a, b) => comparisonSegments(b.prefix).length - comparisonSegments(a.prefix).length,
  );

  const lines = sorted.map((b) => {
    const missing = existsSync(b.prefix) ? "" : "  (missing)";
    return `  ${b.prefix} → ${b.profile}${missing}`;
  });

  process.stdout.write(`${lines.join("\n")}\n`);
  return EXIT_OK;
}
