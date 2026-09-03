import { SUBCOMMAND_NAMES } from "./args.js";

const WINDOWS_DEVICE_NAMES = new Set([
  "con",
  "prn",
  "aux",
  "nul",
  "com1",
  "com2",
  "com3",
  "com4",
  "com5",
  "com6",
  "com7",
  "com8",
  "com9",
  "lpt1",
  "lpt2",
  "lpt3",
  "lpt4",
  "lpt5",
  "lpt6",
  "lpt7",
  "lpt8",
  "lpt9",
]);

const NAME_PATTERN = /^[a-z0-9][a-z0-9_-]*$/;

/**
 * Validates a profile name against spec §6.1: it doubles as a directory
 * name, so the character set is narrow, lowercase is mandatory, and both
 * Windows device names and cswitch's own subcommand names are reserved.
 * Returns an error message, or undefined when the name is valid.
 */
export function validateProfileName(name: string): string | undefined {
  if (!NAME_PATTERN.test(name)) {
    return `cswitch: "${name}" is not a valid profile name — it must match [a-z0-9][a-z0-9_-]* (lowercase only)`;
  }
  if (WINDOWS_DEVICE_NAMES.has(name)) {
    return `cswitch: "${name}" is a reserved Windows device name and cannot be used as a profile name`;
  }
  if ((SUBCOMMAND_NAMES as readonly string[]).includes(name)) {
    return `cswitch: "${name}" is a cswitch subcommand name and cannot be used as a profile name`;
  }
  return undefined;
}
