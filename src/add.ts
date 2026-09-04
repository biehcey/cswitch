import { existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { canonicalizeDir, isSamePrefix, BindingPathError } from "./binding.js";
import { ConfigError, cswitchHomePath, profilesDirPath, readConfig, writeConfig, type Config } from "./config.js";
import { EXIT_OK, EXIT_RUNTIME, EXIT_USAGE } from "./exit-codes.js";
import { ensurePluginsJunction } from "./launch.js";
import { validateProfileName } from "./profile-name.js";

export interface AddProfileParams {
  home: string;
  name: string;
  bindDir?: string;
}

export type AddProfileOutcome =
  | { ok: true; boundDir: string | undefined }
  | { ok: false; message: string; exitCode: number };

/**
 * The `add` chain itself (spec §6.3): directory, plugins/ junction, config
 * record — atomic, in that a failing junction step removes the freshly created
 * directory and writes nothing to config.json, so the machine looks exactly as
 * it did before. It reports failures as a message instead of writing them, so
 * the flag-based command (`runAdd`) and Interactive Mode's add screen (§10.6)
 * run the *same* chain and only differ in where the message is shown.
 */
export function addProfile(params: AddProfileParams): AddProfileOutcome {
  const { home, name, bindDir } = params;
  const cswitchHome = cswitchHomePath(home);

  const nameError = validateProfileName(name);
  if (nameError) {
    return { ok: false, message: nameError, exitCode: EXIT_USAGE };
  }

  let config: Config | undefined;
  try {
    config = readConfig(cswitchHome);
  } catch (err) {
    return { ok: false, message: (err as ConfigError).message, exitCode: EXIT_RUNTIME };
  }

  if (config === undefined) {
    return { ok: false, message: 'cswitch: ~/.cswitch not found. Run "cswitch init" first.', exitCode: EXIT_RUNTIME };
  }

  const profileDir = path.join(profilesDirPath(cswitchHome), name);
  if (config.profiles.some((p) => p.name === name) || existsSync(profileDir)) {
    return { ok: false, message: `cswitch: profile "${name}" already exists`, exitCode: EXIT_USAGE };
  }

  // Validated before anything is written (spec §6.3 reuses bind's validation, §4.1):
  // `add` is never interactive, so a genuine conflict with an existing Binding is
  // always a hard error here, never a TTY prompt — that's `bind`'s job, not `add`'s.
  let canonicalBindDir: string | undefined;
  if (bindDir !== undefined) {
    try {
      canonicalBindDir = canonicalizeDir(bindDir, home);
    } catch (err) {
      return { ok: false, message: (err as BindingPathError).message, exitCode: EXIT_RUNTIME };
    }
    const existing = config.bindings.find((b) => isSamePrefix(b.prefix, canonicalBindDir!));
    if (existing) {
      return {
        ok: false,
        message: `cswitch: "${canonicalBindDir}" is already bound to "${existing.profile}" — use \`cswitch bind --force\` to overwrite`,
        exitCode: EXIT_RUNTIME,
      };
    }
  }

  mkdirSync(profileDir, { recursive: true });

  try {
    ensurePluginsJunction(home, cswitchHome, { name });
  } catch (err) {
    rmSync(profileDir, { recursive: true, force: true });
    return {
      ok: false,
      message: `cswitch: failed to junction plugins/ for "${name}": ${(err as Error).message}`,
      exitCode: EXIT_RUNTIME,
    };
  }

  const nextConfig: Config = {
    ...config,
    profiles: [...config.profiles, { name }],
    bindings:
      canonicalBindDir !== undefined ? [...config.bindings, { prefix: canonicalBindDir, profile: name }] : config.bindings,
  };
  writeConfig(cswitchHome, nextConfig);

  return { ok: true, boundDir: canonicalBindDir };
}

export interface RunAddParams {
  home: string;
  name: string;
  bindDir?: string;
}

/** `cswitch add <name>` (spec §6.3): `addProfile`'s chain plus this command's own output. */
export function runAdd(params: RunAddParams): number {
  const outcome = addProfile(params);
  if (!outcome.ok) {
    process.stderr.write(`${outcome.message}\n`);
    return outcome.exitCode;
  }

  const { name } = params;
  const lines = [
    `  ✓ created ~/.cswitch/profiles/${name}`,
    "  ✓ junctioned plugins/ to ~/.claude/plugins",
    `  ✓ registered "${name}"`,
  ];
  if (outcome.boundDir !== undefined) {
    lines.push(`  ✓ bound ${outcome.boundDir} to ${name}`);
  }
  process.stdout.write(`\n${lines.join("\n")}\n`);
  process.stdout.write(`\nNext: cswitch ${name} -- claude   (the login flow opens there)\n`);
  process.stdout.write(
    "\nNote: global config settings such as autoConnectIde and diffTool are per-profile — you will need to set them again in this profile.\n",
  );

  return EXIT_OK;
}
