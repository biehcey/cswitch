export const SHELL_NAMES = ["bash", "zsh", "fish", "powershell"] as const;

export type ShellName = (typeof SHELL_NAMES)[number];

function isShellName(token: string): token is ShellName {
  return (SHELL_NAMES as readonly string[]).includes(token);
}

export type ParsedShellInitArgs = { kind: "ok"; shell: ShellName } | { kind: "error"; message: string };

const USAGE = "  cswitch shell-init <bash|zsh|fish|powershell>";

/** Parses the arguments after `cswitch shell-init`: exactly one positional shell name,
 * never guessed from the environment. */
export function parseShellInitArgs(rest: string[]): ParsedShellInitArgs {
  if (rest.length === 0) {
    return { kind: "error", message: `cswitch shell-init: a shell name is required\n\n${USAGE}` };
  }

  const [first, ...extra] = rest;
  if (extra.length > 0) {
    return { kind: "error", message: `cswitch shell-init: unexpected argument \`${extra[0]}\`` };
  }

  if (!isShellName(first!)) {
    return {
      kind: "error",
      message: `cswitch shell-init: unsupported shell \`${first}\`\n\n${USAGE}`,
    };
  }

  return { kind: "ok", shell: first };
}
