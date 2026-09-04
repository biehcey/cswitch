export type ParsedUnbindArgs = { kind: "ok"; dir: string } | { kind: "error"; message: string };

/** Parses the arguments after `cswitch unbind`: exactly one positional directory. */
export function parseUnbindArgs(rest: string[]): ParsedUnbindArgs {
  if (rest.length === 0) {
    return { kind: "error", message: "cswitch unbind: a directory is required\n\n  cswitch unbind <dir>" };
  }

  const [first, ...extra] = rest;
  if (first!.startsWith("-")) {
    return { kind: "error", message: `cswitch unbind: unknown argument \`${first}\`` };
  }
  if (extra.length > 0) {
    return { kind: "error", message: `cswitch unbind: unexpected argument \`${extra[0]}\`` };
  }

  return { kind: "ok", dir: first! };
}
