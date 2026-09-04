export type ParsedBindArgs =
  | { kind: "bind"; dir: string; profile: string; force: boolean }
  | { kind: "list" }
  | { kind: "error"; message: string };

const USAGE = "  cswitch bind <dir> <profile>\n  cswitch bind --list";

/** Parses the arguments after `cswitch bind`: either `--list`, or a directory and a
 * profile name (in that order) with an optional `--force`. */
export function parseBindArgs(rest: string[]): ParsedBindArgs {
  if (rest.length === 0) {
    return { kind: "error", message: `cswitch bind: a directory and a profile name are required\n\n${USAGE}` };
  }

  if (rest.includes("--list")) {
    if (rest.length > 1) {
      return { kind: "error", message: "cswitch bind: `--list` does not take other arguments" };
    }
    return { kind: "list" };
  }

  let force = false;
  const positional: string[] = [];
  for (const token of rest) {
    if (token === "--force") {
      force = true;
      continue;
    }
    if (token.startsWith("-")) {
      return { kind: "error", message: `cswitch bind: unknown argument \`${token}\`` };
    }
    positional.push(token);
  }

  if (positional.length < 2) {
    return { kind: "error", message: `cswitch bind: a directory and a profile name are required\n\n${USAGE}` };
  }
  if (positional.length > 2) {
    return { kind: "error", message: `cswitch bind: unexpected argument \`${positional[2]}\`` };
  }

  const [dir, profile] = positional;
  return { kind: "bind", dir: dir!, profile: profile!, force };
}
