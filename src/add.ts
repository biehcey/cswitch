import { existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { ConfigError, cswitchHomePath, profilesDirPath, readConfig, writeConfig, type Config } from "./config.js";
import { EXIT_OK, EXIT_RUNTIME, EXIT_USAGE } from "./exit-codes.js";
import { ensurePluginsJunction } from "./launch.js";
import { validateProfileName } from "./profile-name.js";

export interface RunAddParams {
  home: string;
  name: string;
}

/**
 * `cswitch add <name>` (spec §6.3): pure preparation, never interactive. The
 * chain — directory, plugins/ junction, config record — is atomic: if the
 * junction step fails, the freshly created directory is removed and nothing
 * is written to config.json, so the machine looks exactly as it did before.
 */
export function runAdd(params: RunAddParams): number {
  const { home, name } = params;
  const cswitchHome = cswitchHomePath(home);

  const nameError = validateProfileName(name);
  if (nameError) {
    process.stderr.write(`${nameError}\n`);
    return EXIT_USAGE;
  }

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

  const profileDir = path.join(profilesDirPath(cswitchHome), name);
  if (config.profiles.some((p) => p.name === name) || existsSync(profileDir)) {
    process.stderr.write(`cswitch: profile "${name}" already exists\n`);
    return EXIT_USAGE;
  }

  mkdirSync(profileDir, { recursive: true });

  try {
    ensurePluginsJunction(home, cswitchHome, { name });
  } catch (err) {
    rmSync(profileDir, { recursive: true, force: true });
    process.stderr.write(`cswitch: failed to junction plugins/ for "${name}": ${(err as Error).message}\n`);
    return EXIT_RUNTIME;
  }

  const nextConfig: Config = { ...config, profiles: [...config.profiles, { name }] };
  writeConfig(cswitchHome, nextConfig);

  const lines = [
    `  ✓ created ~/.cswitch/profiles/${name}`,
    "  ✓ junctioned plugins/ to ~/.claude/plugins",
    `  ✓ registered "${name}"`,
  ];
  process.stdout.write(`\n${lines.join("\n")}\n`);
  process.stdout.write(`\nNext: cswitch ${name} -- claude   (the login flow opens there)\n`);
  process.stdout.write(
    "\nNote: global config settings such as autoConnectIde and diffTool are per-profile — you will need to set them again in this profile.\n",
  );

  return EXIT_OK;
}
