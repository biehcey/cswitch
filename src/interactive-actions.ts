/**
 * The single source for the Profile list's one-key launch actions (spec §10.3/
 * §10.5): `interactive-view.ts` builds the footer hints from this table and
 * `interactive.ts` dispatches keypresses from it, so a key can never be
 * advertised without being wired up, or wired up without being advertised.
 *
 * It lives in its own module rather than in either of those: putting it in the
 * view would smuggle behaviour (`["claude", "--continue"]`) into a module whose
 * whole point is purity, and putting it in `interactive.ts` would make the view
 * depend on the behaviour module — today the arrow points the other way.
 */
export interface LaunchAction {
  /** The single character that triggers it. Must not collide with the list's own
   * keys (`a`, `d`) or the confirmation screen's (`y`, `n`). */
  key: string;
  /** The word shown in the footer; starts with `key` so the hint can bracket its
   * first character (`continue` → `[c]ontinue`). */
  label: string;
  /** The command handed to the Launcher (§5), exactly as `--` would pass it. */
  command: string[];
}

/**
 * The three `claude` invocations that are needed often enough to earn a key, and
 * that are Profile-dependent — without the right `CLAUDE_CONFIG_DIR` they all
 * resume or inspect the wrong Account's state.
 *
 * `m` is `claude mcp list`, not a bare `claude mcp`: with no argument `mcp`
 * prints its help and exits, which — combined with §10.5's "Interactive Mode
 * never reopens itself" — would make the key mean "print help and drop out of
 * the terminal". `--dangerously-skip-permissions` is deliberately absent; see
 * docs/adr/0001-interactive-mode-launch-keys.md.
 */
export const LAUNCH_ACTIONS: LaunchAction[] = [
  { key: "c", label: "continue", command: ["claude", "--continue"] },
  { key: "r", label: "resume", command: ["claude", "--resume"] },
  { key: "m", label: "mcp", command: ["claude", "mcp", "list"] },
];
