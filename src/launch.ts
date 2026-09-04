import spawn from "cross-spawn";
import { lstatSync, mkdirSync, readdirSync, readlinkSync, rmdirSync, symlinkSync, unlinkSync } from "node:fs";
import path from "node:path";
import { formatAccount, readAccount, type AccountDisplay } from "./account.js";
import { matchBinding, tryCanonicalize } from "./binding.js";
import { profilesDirPath, settingsPath, type Binding, type Config, type ProfileRecord } from "./config.js";
import { EXIT_RUNTIME } from "./exit-codes.js";

export type ProfileResolution =
  | { kind: "resolved"; record: ProfileRecord; usedDefault: boolean }
  | { kind: "not-found"; name: string }
  | { kind: "no-default" };

/**
 * Resolves which profile a launch targets (spec §5.2 step 1, §4.4): an
 * explicit name always overrides everything else and must exist in config;
 * omitting it tries `matchedBinding` next (already resolved against cwd by
 * the caller — a stale Binding whose profile no longer exists is treated as
 * no match); with neither, it falls through to the Default Profile (the one
 * profile with inPlace: true).
 */
export function resolveLaunchProfile(
  config: Config | undefined,
  profileName: string | undefined,
  matchedBinding: Binding | undefined = undefined,
): ProfileResolution {
  if (profileName !== undefined) {
    const record = config?.profiles.find((p) => p.name === profileName);
    if (!record) {
      return { kind: "not-found", name: profileName };
    }
    return { kind: "resolved", record, usedDefault: false };
  }

  if (matchedBinding !== undefined) {
    const record = config?.profiles.find((p) => p.name === matchedBinding.profile);
    if (record) {
      return { kind: "resolved", record, usedDefault: false };
    }
  }

  const record = config?.profiles.find((p) => p.inPlace === true);
  if (!record) {
    return { kind: "no-default" };
  }
  return { kind: "resolved", record, usedDefault: true };
}

/**
 * Resolves the Binding, if any, matching `cwd` (spec §4.3, §4.4) — skipped
 * entirely when a profile name was given explicitly, since it always wins.
 * An unresolvable cwd (deleted, permission error) is not a hard failure: it
 * warns to stderr and reads as "no match", so the caller falls back to the
 * Default Profile.
 */
export function resolveCwdBinding(
  config: Config | undefined,
  profileName: string | undefined,
  cwd: string,
  warn: (message: string) => void,
): Binding | undefined {
  if (profileName !== undefined || config === undefined) {
    return undefined;
  }

  const canonicalCwd = tryCanonicalize(cwd);
  if (canonicalCwd === undefined) {
    warn("cswitch: could not resolve the current directory — falling back to the default profile\n");
    return undefined;
  }

  if (config.bindings.length === 0) {
    return undefined;
  }

  return matchBinding(config.bindings, canonicalCwd);
}

/** The profile's `CLAUDE_CONFIG_DIR` — undefined for an in-place profile (spec §5.2 step 2). */
export function profileConfigDir(cswitchHome: string, record: ProfileRecord): string | undefined {
  if (record.inPlace) {
    return undefined;
  }
  return path.join(profilesDirPath(cswitchHome), record.name);
}

/** Where to read this profile's identity from (spec §5.6). */
export function profileClaudeJsonPath(home: string, cswitchHome: string, record: ProfileRecord): string {
  if (record.inPlace) {
    return path.join(home, ".claude.json");
  }
  return path.join(profilesDirPath(cswitchHome), record.name, ".claude.json");
}

/**
 * Builds the child process environment: sets `CLAUDE_CONFIG_DIR` for a
 * non-in-place profile, or strips any inherited value for an in-place one.
 * This, together with profileConfigDir, is the only place `inPlace` is read
 * (spec §5.2 step 2) — the rest of the launcher treats profiles uniformly.
 */
export function buildChildEnv(baseEnv: NodeJS.ProcessEnv, cswitchHome: string, record: ProfileRecord): NodeJS.ProcessEnv {
  const env = { ...baseEnv };
  const configDir = profileConfigDir(cswitchHome, record);
  if (configDir === undefined) {
    delete env.CLAUDE_CONFIG_DIR;
  } else {
    env.CLAUDE_CONFIG_DIR = configDir;
  }
  return env;
}

/** Path to the shared plugins store every non-in-place profile junctions into (spec §3). */
export function sharedPluginsPath(home: string): string {
  return path.join(home, ".claude", "plugins");
}

/** Path to a profile's own `plugins/` entry — a junction, unless blocked (spec §5.3). */
export function profilePluginsPath(cswitchHome: string, record: ProfileRecord): string {
  return path.join(profilesDirPath(cswitchHome), record.name, "plugins");
}

export type JunctionEnsureResult =
  | { kind: "created" }
  | { kind: "recreated" }
  | { kind: "ok" }
  | { kind: "blocked" };

/**
 * Ensures `<profile>/plugins` is a junction to the shared plugins store (spec
 * §5.3), run on every launch for non-in-place profiles. Missing → created
 * silently. A junction whose target is wrong or broken → recreated. A real,
 * non-empty directory is never touched — cswitch never deletes a `plugins/`
 * the user set up by hand; an empty real directory is treated like "missing"
 * since it holds nothing to lose.
 */
export function ensurePluginsJunction(home: string, cswitchHome: string, record: ProfileRecord): JunctionEnsureResult {
  const target = sharedPluginsPath(home);
  const linkPath = profilePluginsPath(cswitchHome, record);
  mkdirSync(path.dirname(linkPath), { recursive: true });

  let stat;
  try {
    stat = lstatSync(linkPath);
  } catch {
    symlinkSync(target, linkPath, "junction");
    return { kind: "created" };
  }

  if (stat.isSymbolicLink()) {
    let currentTarget: string | undefined;
    try {
      currentTarget = readlinkSync(linkPath);
    } catch {
      currentTarget = undefined;
    }
    if (currentTarget === target) {
      return { kind: "ok" };
    }
    unlinkSync(linkPath);
    symlinkSync(target, linkPath, "junction");
    return { kind: "recreated" };
  }

  if (readdirSync(linkPath).length > 0) {
    return { kind: "blocked" };
  }
  rmdirSync(linkPath);
  symlinkSync(target, linkPath, "junction");
  return { kind: "recreated" };
}

const WIN32_EXECUTABLE_EXTENSIONS = /\.(cmd|exe|ps1|bat)$/i;

/** Known Claude Code subcommands `--settings` isn't accepted on (spec §5.4) — a stale list
 * is a known tradeoff, escaped at runtime by `CSWITCH_NO_SETTINGS=1` rather than probed. */
const KNOWN_CLAUDE_SUBCOMMANDS = new Set([
  "mcp",
  "plugin",
  "config",
  "doctor",
  "update",
  "install",
  "migrate-installer",
  "setup-token",
  "agents",
]);

/**
 * Whether the executed command names `claude` (spec §5.4 step 1) once its
 * path and, on win32, executable extension are stripped. Comparison is
 * case-insensitive only on win32, where executable names already are.
 */
export function isClaudeCommand(command0: string, platform: NodeJS.Platform = process.platform): boolean {
  let base = path.basename(command0);
  if (platform === "win32") {
    base = base.replace(WIN32_EXECUTABLE_EXTENSIONS, "").toLowerCase();
    return base === "claude";
  }
  return base === "claude";
}

/**
 * Whether `--settings` should be injected into the launched command (spec
 * §5.4): the command is `claude`, its first non-flag token (if any) isn't a
 * known subcommand, and the escape hatch isn't set.
 */
export function shouldInjectSettings(
  command: string[],
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform = process.platform,
): boolean {
  if (env.CSWITCH_NO_SETTINGS === "1") {
    return false;
  }
  if (command.length === 0 || !isClaudeCommand(command[0]!, platform)) {
    return false;
  }
  const firstNonFlag = command.slice(1).find((token) => !token.startsWith("-"));
  if (firstNonFlag !== undefined && KNOWN_CLAUDE_SUBCOMMANDS.has(firstNonFlag)) {
    return false;
  }
  return true;
}

/**
 * Builds the command actually spawned, inserting `--settings <absolute path
 * to ~/.cswitch/settings.json>` as the first argument after `claude` (spec
 * §5.4) when `shouldInjectSettings` says to; otherwise returns `command`
 * unchanged.
 */
export function buildLaunchCommand(
  command: string[],
  cswitchHome: string,
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform = process.platform,
): string[] {
  if (!shouldInjectSettings(command, env, platform)) {
    return command;
  }
  return [command[0]!, "--settings", path.resolve(settingsPath(cswitchHome)), ...command.slice(1)];
}

/**
 * The fixed-prefix startup line written to stderr (spec §5.5). The
 * "[no binding — default]" tag appears only when the profile was reached by
 * falling through to the Default Profile, not when it was named explicitly.
 */
export function formatStartupLine(profileName: string, account: AccountDisplay, usedDefault: boolean): string {
  const suffix = usedDefault ? "  [no binding — default]" : "";
  return `cswitch: ${profileName} · ${formatAccount(account)}${suffix}`;
}

/** Whether the startup line should be suppressed (spec §5.5: explicit opt-in only). */
export function isQuiet(flagQuiet: boolean, env: NodeJS.ProcessEnv): boolean {
  return flagQuiet || env.CSWITCH_QUIET === "1";
}

/**
 * Spawns the child with stdio inherited and waits for it to finish,
 * forwarding its exit behavior faithfully (spec §5.7): a normal exit's code
 * passes through unchanged. A signal death is replayed by removing our own
 * SIGINT/SIGTERM listeners (restoring the default disposition) and
 * re-sending ourselves the same signal, so the invoking shell's `$?` stays
 * accurate. Until then, the parent ignores SIGINT/SIGTERM so Ctrl-C reaches
 * the child directly (same process group).
 */
export function spawnAndWait(command: string[], env: NodeJS.ProcessEnv): Promise<number> {
  return new Promise((resolve) => {
    // cross-spawn, not node:child_process directly: on Windows, a global npm
    // install's claude.cmd shim can't be spawned by plain spawn() without
    // shell: true, and shell: true concatenates args unescaped (a Node
    // deprecation warning as of DEP0190) — cross-spawn resolves and invokes
    // .cmd/.bat shims safely without that risk.
    const child = spawn(command[0]!, command.slice(1), { stdio: "inherit", env });

    const ignoreSignal = () => {};
    process.on("SIGINT", ignoreSignal);
    process.on("SIGTERM", ignoreSignal);

    const stopIgnoringSignals = () => {
      process.removeListener("SIGINT", ignoreSignal);
      process.removeListener("SIGTERM", ignoreSignal);
    };

    child.on("error", (err) => {
      stopIgnoringSignals();
      process.stderr.write(`cswitch: failed to start "${command[0]}": ${(err as Error).message}\n`);
      resolve(EXIT_RUNTIME);
    });

    child.on("exit", (code, signal) => {
      stopIgnoringSignals();
      if (signal) {
        process.kill(process.pid, signal);
        return;
      }
      resolve(code ?? EXIT_RUNTIME);
    });
  });
}

export interface RunLaunchParams {
  home: string;
  cswitchHome: string;
  config: Config | undefined;
  profileName: string | undefined;
  quiet: boolean;
  command: string[];
  env: NodeJS.ProcessEnv;
  cwd: string;
}

/** Orchestrates a launch end to end: resolve profile, announce, spawn (spec §5.2). */
export async function runLaunch(params: RunLaunchParams): Promise<number> {
  const { home, cswitchHome, config, profileName, quiet, command, env, cwd } = params;

  const matchedBinding = resolveCwdBinding(config, profileName, cwd, (message) => process.stderr.write(message));
  const resolution = resolveLaunchProfile(config, profileName, matchedBinding);
  if (resolution.kind === "not-found") {
    process.stderr.write(`cswitch: no profile named "${resolution.name}" in ~/.cswitch/config.json\n`);
    return EXIT_RUNTIME;
  }
  if (resolution.kind === "no-default") {
    process.stderr.write("cswitch: no default profile registered — run `cswitch init` first\n");
    return EXIT_RUNTIME;
  }

  const { record, usedDefault } = resolution;

  if (!record.inPlace) {
    const junction = ensurePluginsJunction(home, cswitchHome, record);
    if (junction.kind === "blocked") {
      process.stderr.write(
        `cswitch: ~/.cswitch/profiles/${record.name}/plugins is a real, non-empty directory — refusing to replace it. Move it aside or remove it, then try again.\n`,
      );
      return EXIT_RUNTIME;
    }
  }

  if (!isQuiet(quiet, env)) {
    const account = readAccount(profileClaudeJsonPath(home, cswitchHome, record));
    process.stderr.write(`${formatStartupLine(record.name, account, usedDefault)}\n`);
  }

  return spawnAndWait(buildLaunchCommand(command, cswitchHome, env), buildChildEnv(env, cswitchHome, record));
}
