import type { ShellName } from "./shell-init-args.js";

const BASH_ZSH = `# cswitch
claude() {
  if command -v cswitch >/dev/null 2>&1; then
    cswitch -- claude "$@"
  else
    command claude "$@"
  fi
}`;

const FISH = `# cswitch
function claude
    if command -q cswitch
        cswitch -- claude $argv
    else
        command claude $argv
    end
end`;

const POWERSHELL = `# cswitch
function claude {
    if (Get-Command cswitch -ErrorAction SilentlyContinue) { & cswitch -- claude @args }
    else { & (Get-Command claude -CommandType Application | Select-Object -First 1) @args }
}`;

/** Renders the shell function body that hands plain `claude` off to cswitch (spec §6.7).
 * Pure formatting — no filesystem or environment access, safe to run on every shell start. */
export function renderShellInit(shell: ShellName): string {
  switch (shell) {
    case "bash":
    case "zsh":
      return BASH_ZSH;
    case "fish":
      return FISH;
    case "powershell":
      return POWERSHELL;
  }
}
