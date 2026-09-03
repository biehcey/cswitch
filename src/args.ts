export const SUBCOMMAND_NAMES = [
  "init",
  "add",
  "bind",
  "unbind",
  "status",
  "shell-init",
] as const;

export type SubcommandName = (typeof SUBCOMMAND_NAMES)[number];

export function isSubcommandName(token: string): token is SubcommandName {
  return (SUBCOMMAND_NAMES as readonly string[]).includes(token);
}

export type ParsedArgs =
  | { kind: "help"; exitCode: 0 | 64 }
  | { kind: "version" }
  | { kind: "usage-error"; message: string }
  | { kind: "subcommand"; name: SubcommandName; rest: string[] }
  | { kind: "launch"; profile: string | undefined; quiet: boolean; command: string[] };

const USAGE_LINE = "cswitch [<profile>] -- <command> [args...]";

function usageError(message: string): ParsedArgs {
  return {
    kind: "usage-error",
    message: `cswitch: ${message}\n\n  ${USAGE_LINE}\n\nRun \`cswitch --help\` for usage.`,
  };
}

/**
 * Parses argv (already stripped of `node`/script path) into the top-level
 * grammar: `cswitch [<profile>] -- <command> [args...]` or a known
 * subcommand. Everything after a literal `--` is returned untouched, never
 * inspected.
 */
export function parseTopLevel(argv: string[]): ParsedArgs {
  if (argv.length === 0) {
    return { kind: "help", exitCode: 64 };
  }

  const dashDashIndex = argv.indexOf("--");

  if (dashDashIndex === -1) {
    if (argv.length === 1 && (argv[0] === "-h" || argv[0] === "--help")) {
      return { kind: "help", exitCode: 0 };
    }
    if (argv.length === 1 && (argv[0] === "-V" || argv[0] === "--version")) {
      return { kind: "version" };
    }

    const first = argv[0]!;
    if (isSubcommandName(first)) {
      return { kind: "subcommand", name: first, rest: argv.slice(1) };
    }

    return usageError("`--` is required before the command");
  }

  const pre = argv.slice(0, dashDashIndex);
  const command = argv.slice(dashDashIndex + 1);

  if (command.length === 0) {
    return usageError("a command is required after `--`");
  }

  let profile: string | undefined;
  let quiet = false;

  for (const token of pre) {
    if (token === "-q" || token === "--quiet") {
      quiet = true;
      continue;
    }
    if (token === "-h" || token === "--help" || token === "-V" || token === "--version") {
      return usageError(`\`${token}\` is not valid together with a profile or \`--\``);
    }
    if (token.startsWith("-")) {
      return usageError(`unknown option \`${token}\``);
    }
    if (profile !== undefined) {
      return usageError("at most one profile name is accepted before `--`");
    }
    profile = token;
  }

  return { kind: "launch", profile, quiet, command };
}
