export const HELP_TEXT = `cswitch — run multiple Claude Code accounts on one machine

USAGE
  cswitch [<profile>] -- <command> [args...]   run a command in a profile's environment
  cswitch <subcommand> [options]

  Without a profile name, the binding matching the current directory decides; with no
  match, the default profile is used. Naming a profile always overrides the binding.
  Everything after \`--\` is passed through untouched.

SUBCOMMANDS
  init                 set cswitch up on this machine, adopting ~/.claude as-is
  add <name>           create a new profile
  bind <dir> <name>    bind a directory prefix to a profile
  unbind <dir>         remove a binding
  status               show what runs here, and every profile
  shell-init <shell>   print the \`claude\` wrapper for your shell

OPTIONS  (only valid before \`--\`)
  -q, --quiet     do not print the launch line (same as CSWITCH_QUIET=1)
  -h, --help      show this help
  -V, --version   show version

EXAMPLES
  cswitch -- claude                  pick the profile for this directory, run claude
  cswitch personal -- claude         run in the personal profile, ignoring bindings
  cswitch work -- claude mcp list    subcommands pass through
  cswitch work -- node script.js     any command can be wrapped, not just claude
  eval "$(cswitch shell-init zsh)"   make plain \`claude\` go through cswitch

EXIT CODES
  The wrapped command's exit code is passed through unchanged. cswitch's own failures
  use 64 (usage) and 70 (runtime), so they never look like a claude exit code.`;
