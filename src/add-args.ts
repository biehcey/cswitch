export type ParsedAddArgs = { kind: "ok"; name: string } | { kind: "error"; message: string };

/** Parses the arguments after `cswitch add`: exactly one positional profile name. */
export function parseAddArgs(rest: string[]): ParsedAddArgs {
  if (rest.length === 0) {
    return { kind: "error", message: "cswitch add: a profile name is required\n\n  cswitch add <name>" };
  }

  const [first, ...extra] = rest;
  if (first!.startsWith("-")) {
    return { kind: "error", message: `cswitch add: unknown argument \`${first}\`` };
  }
  if (extra.length > 0) {
    return { kind: "error", message: `cswitch add: unexpected argument \`${extra[0]}\`` };
  }

  return { kind: "ok", name: first! };
}
