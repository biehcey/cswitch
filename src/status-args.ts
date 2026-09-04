export type ParsedStatusArgs = { kind: "ok"; json: boolean } | { kind: "error"; message: string };

/** Parses the arguments after `cswitch status`: an optional `--json` flag, nothing else. */
export function parseStatusArgs(rest: string[]): ParsedStatusArgs {
  let json = false;
  for (const token of rest) {
    if (token === "--json") {
      json = true;
      continue;
    }
    return { kind: "error", message: `cswitch status: unknown argument \`${token}\`` };
  }
  return { kind: "ok", json };
}
