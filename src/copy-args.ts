export type ParsedCopyArgs =
  | { kind: "ok"; source: string; target: string; plugins: boolean; mcp: boolean; dryRun: boolean }
  | { kind: "error"; message: string };

const USAGE = "  cswitch copy <source> <target> [--plugins] [--mcp] [--dry-run]";

/**
 * Parses the arguments after `cswitch copy`: two positional profile names (source
 * first) plus the category flags. Neither category flag means both (§K3), so the
 * common case needs no flags at all.
 */
export function parseCopyArgs(rest: string[]): ParsedCopyArgs {
  if (rest.length === 0) {
    return { kind: "error", message: `cswitch copy: a source and a target profile are required\n\n${USAGE}` };
  }

  let plugins = false;
  let mcp = false;
  let dryRun = false;
  const positional: string[] = [];

  for (const token of rest) {
    if (token === "--plugins") {
      plugins = true;
      continue;
    }
    if (token === "--mcp") {
      mcp = true;
      continue;
    }
    if (token === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (token.startsWith("-")) {
      return { kind: "error", message: `cswitch copy: unknown argument \`${token}\`` };
    }
    positional.push(token);
  }

  if (positional.length < 2) {
    return { kind: "error", message: `cswitch copy: a source and a target profile are required\n\n${USAGE}` };
  }
  if (positional.length > 2) {
    return { kind: "error", message: `cswitch copy: unexpected argument \`${positional[2]}\`` };
  }

  const [source, target] = positional as [string, string];
  if (source === target) {
    return { kind: "error", message: `cswitch copy: the source and target profile are the same ("${source}")` };
  }

  // Neither flag means both categories (§K3).
  if (!plugins && !mcp) {
    plugins = true;
    mcp = true;
  }

  return { kind: "ok", source, target, plugins, mcp, dryRun };
}
