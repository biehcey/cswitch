export type ParsedRecentArgs = { kind: "ok" } | { kind: "error"; message: string };

/** Parses the arguments after `cswitch recent`: none (issue K8) — `--limit`/`--json` wait for real demand. */
export function parseRecentArgs(rest: string[]): ParsedRecentArgs {
  if (rest.length > 0) {
    return { kind: "error", message: `cswitch recent: unknown argument \`${rest[0]}\`` };
  }
  return { kind: "ok" };
}
