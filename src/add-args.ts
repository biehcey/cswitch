export type ParsedAddArgs = { kind: "ok"; name: string; bindDir?: string } | { kind: "error"; message: string };

const USAGE = "  cswitch add <name> [--bind <dir>]";

/** Parses the arguments after `cswitch add`: one positional profile name and an
 * optional `--bind <dir>`. */
export function parseAddArgs(rest: string[]): ParsedAddArgs {
  if (rest.length === 0) {
    return { kind: "error", message: `cswitch add: a profile name is required\n\n${USAGE}` };
  }

  let name: string | undefined;
  let bindDir: string | undefined;

  for (let i = 0; i < rest.length; i++) {
    const token = rest[i]!;
    if (token === "--bind") {
      const value = rest[i + 1];
      if (value === undefined) {
        return { kind: "error", message: "cswitch add: `--bind` requires a directory argument" };
      }
      bindDir = value;
      i++;
      continue;
    }
    if (token.startsWith("-")) {
      return { kind: "error", message: `cswitch add: unknown argument \`${token}\`` };
    }
    if (name !== undefined) {
      return { kind: "error", message: `cswitch add: unexpected argument \`${token}\`` };
    }
    name = token;
  }

  if (name === undefined) {
    return { kind: "error", message: `cswitch add: a profile name is required\n\n${USAGE}` };
  }

  return { kind: "ok", name, bindDir };
}
