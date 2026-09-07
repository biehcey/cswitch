export const HELP_TEXT = `cswitch — run multiple Claude Code accounts on one machine

USAGE
  cswitch                                      open the interactive profile list
  cswitch [<profile>] -- <command> [args...]   run a command in a profile's environment
  cswitch <subcommand> [options]

  Without a profile name, the binding matching the current directory decides; with no
  match, the default profile is used. Naming a profile always overrides the binding.
  Everything after \`--\` is passed through untouched.

  With no arguments on a terminal, cswitch opens the interactive profile list: arrow
  keys move, [enter] runs claude in the selected profile, [c] --continue, [r] --resume,
  [m] mcp list, [a] adds, [d] removes, [esc] quits. It runs setup first if ~/.cswitch
  does not exist yet. Off a terminal — a pipe, a script, CI — there is no one to drive
  it, so this help is printed instead.

SUBCOMMANDS
  init                 set cswitch up on this machine, adopting ~/.claude as-is
  add <name>           create a new profile
  remove <name>        delete a profile
  bind <dir> <name>    bind a directory prefix to a profile
  bind --list          list every binding
  unbind <dir>         remove a binding
  copy <src> <dst>     copy enabled plugins and MCP servers between profiles
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
