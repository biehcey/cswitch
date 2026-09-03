export type ParsedInitArgs = { kind: "ok"; name?: string } | { kind: "error"; message: string };

/** Parses the arguments after `cswitch init`. Only `--name <name>` is recognised. */
export function parseInitArgs(rest: string[]): ParsedInitArgs {
  let name: string | undefined;

  for (let i = 0; i < rest.length; i++) {
    const token = rest[i]!;
    if (token === "--name") {
      const value = rest[i + 1];
      if (value === undefined) {
        return { kind: "error", message: "cswitch init: `--name` requires a value" };
      }
      name = value;
      i++;
      continue;
    }
    return { kind: "error", message: `cswitch init: unknown argument \`${token}\`` };
  }

  return { kind: "ok", name };
}
