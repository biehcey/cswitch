import path from "node:path";
import { formatAccount, readAccount } from "./account.js";
import { isInGlobalBinDir } from "./bin-check.js";
import {
  ConfigError,
  cswitchHomePath,
  ensureCswitchTree,
  ensureSharedSettings,
  readConfig,
  writeConfig,
  type Config,
} from "./config.js";
import { EXIT_OK, EXIT_RUNTIME, EXIT_USAGE } from "./exit-codes.js";
import type { Io } from "./io.js";
import { validateProfileName } from "./profile-name.js";

export interface RunInitParams {
  home: string;
  nameFlag: string | undefined;
  io: Io;
  env: NodeJS.ProcessEnv;
}

function reportLine(taken: boolean, text: string): string {
  return `  ${taken ? "✓" : "·"} ${text}`;
}

function warnLine(text: string): string {
  return `  ! ${text}`;
}

const ANNOUNCEMENT = `cswitch is about to:
  • create ~/.cswitch/{config.json, settings.json, profiles/}
  • register your existing ~/.claude as the default profile — the directory is not
    touched, moved, or copied
  • to back out later: rm -rf ~/.cswitch
`;

export async function runInit(params: RunInitParams): Promise<number> {
  const { home, nameFlag, io, env } = params;
  const cswitchHome = cswitchHomePath(home);
  const claudeJsonPath = path.join(home, ".claude.json");

  let config: Config | undefined;
  try {
    config = readConfig(cswitchHome);
  } catch (err) {
    process.stderr.write(`${(err as ConfigError).message}\n`);
    return EXIT_RUNTIME;
  }

  const existingDefault = config?.profiles.find((p) => p.inPlace === true);

  let profileName: string;

  if (existingDefault) {
    profileName = existingDefault.name;
  } else {
    io.write(`\n${ANNOUNCEMENT}\n`);

    const account = readAccount(claudeJsonPath);
    io.write(`Current account: ${formatAccount(account)}\n`);

    let resolvedName: string;
    if (nameFlag !== undefined) {
      resolvedName = nameFlag;
    } else if (io.isTTY) {
      const answer = (await io.question("Name for this profile? [default] ")).trim();
      resolvedName = answer.length > 0 ? answer : "default";
    } else {
      resolvedName = "default";
    }

    const nameError = validateProfileName(resolvedName);
    if (nameError) {
      process.stderr.write(`${nameError}\n`);
      return EXIT_USAGE;
    }

    profileName = resolvedName;
    io.write("\n");
  }

  const lines: string[] = [];

  const { createdHome, createdProfilesDir } = ensureCswitchTree(cswitchHome);
  if (createdHome) {
    lines.push(reportLine(true, "created ~/.cswitch/"));
  } else if (createdProfilesDir) {
    lines.push(reportLine(true, "created the missing ~/.cswitch/profiles/"));
  } else {
    lines.push(reportLine(false, "~/.cswitch/ already exists"));
  }

  const wroteSettings = ensureSharedSettings(cswitchHome);
  if (wroteSettings) {
    const text = existingDefault
      ? "restored the missing shared settings.json as {}"
      : "created the shared settings.json as {}";
    lines.push(reportLine(true, text));
  } else {
    lines.push(reportLine(false, "kept the existing settings.json"));
  }

  if (existingDefault) {
    lines.push(reportLine(false, `kept the existing "${profileName}" registration`));
  } else {
    const nextConfig: Config = config ?? { version: 1, profiles: [], bindings: [] };
    nextConfig.profiles.push({ name: profileName, inPlace: true });
    writeConfig(cswitchHome, nextConfig);
    lines.push(reportLine(true, `registered "${profileName}" as the default profile (in place: ~/.claude)`));
  }

  io.write(`${lines.join("\n")}\n`);

  if (!isInGlobalBinDir(env)) {
    io.write(
      `\n${warnLine(
        'cswitch is not running from a global bin directory — the shell hook ("cswitch shell-init") will silently fall back to the real claude. Install with "npm i -g cswitch".',
      )}\n`,
    );
  }

  if (!existingDefault) {
    io.write("\nNext: cswitch add personal\n");
  }

  return EXIT_OK;
}
