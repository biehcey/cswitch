export type ParsedRemoveArgs =
  | { kind: "ok"; name: string; force: boolean }
  | { kind: "help" }
  | { kind: "error"; message: string };

const USAGE = "  cswitch remove <name> [--force]";

// spec §6.4, reproduced verbatim — the acceptance test compares against this block directly.
export const REMOVE_HELP_TEXT = `cswitch remove — delete a profile

  Deletes the profile's directory, its config.json record, and any bindings that
  point at it. On macOS, also best-effort deletes its Keychain entry — a failure
  there is logged as a warning but never stops the removal. Directory deletion
  happens last: it is the one irreversible step.

USAGE
  cswitch remove <name> [--force]

OPTIONS
  --force   skip the confirmation prompt

  Asks "delete <name>? this cannot be undone" (y/n) before deleting, unless --force
  is given. Without a TTY, --force is required — there is no one to confirm with.
  Refuses to remove the default profile; to back that out, delete ~/.cswitch
  entirely instead. Fails if the named profile doesn't exist.`;

/** Parses the arguments after `cswitch remove`: one positional profile name and an
 * optional `--force`, or `-h`/`--help`. */
export function parseRemoveArgs(rest: string[]): ParsedRemoveArgs {
  if (rest.includes("-h") || rest.includes("--help")) {
    return { kind: "help" };
  }

  if (rest.length === 0) {
    return { kind: "error", message: `cswitch remove: a profile name is required\n\n${USAGE}` };
  }

  let name: string | undefined;
  let force = false;

  for (const token of rest) {
    if (token === "--force") {
      force = true;
      continue;
    }
    if (token.startsWith("-")) {
      return { kind: "error", message: `cswitch remove: unknown argument \`${token}\`` };
    }
    if (name !== undefined) {
      return { kind: "error", message: `cswitch remove: unexpected argument \`${token}\`` };
    }
    name = token;
  }

  if (name === undefined) {
    return { kind: "error", message: `cswitch remove: a profile name is required\n\n${USAGE}` };
  }

  return { kind: "ok", name, force };
}
