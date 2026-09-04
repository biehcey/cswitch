import { addProfile, type AddProfileOutcome, type AddProfileParams } from "./add.js";
import { ConfigError, readConfig, type Config } from "./config.js";
import { EXIT_OK, EXIT_RUNTIME } from "./exit-codes.js";
import type { Io } from "./io.js";
import { runInit } from "./init.js";
import { CLEAR_SCREEN, renderAddScreen, renderProfileList } from "./interactive-view.js";
import { type KeyboardInput, type RawModeStdin, listenForKeys } from "./keyboard.js";
import { type RunLaunchParams, runLaunch } from "./launch.js";
import { buildStatusReport } from "./status.js";

export interface RunInteractiveParams {
  home: string;
  cswitchHome: string;
  env: NodeJS.ProcessEnv;
  cwd: string;
  io: Io;
  stdin: RawModeStdin;
  write: (text: string) => void;
  listen?: typeof listenForKeys;
  launch?: (params: RunLaunchParams) => Promise<number>;
  add?: (params: AddProfileParams) => AddProfileOutcome;
}

/**
 * Interactive Mode entry point (spec §10.1–§10.5): if `~/.cswitch/` doesn't
 * exist yet, runs the same setup the wizard does (`runInit`, reused verbatim —
 * spec §10.4 only requires doing §6.2's job, not repeating its exact wording),
 * then always falls into the Profile list. The caller (`cli.ts`) has already
 * checked `argv.length === 0 && process.stdin.isTTY === true` (spec §10.1) —
 * this function does not re-check TTY-ness itself.
 */
export async function runInteractive(params: RunInteractiveParams): Promise<number> {
  const { home, cswitchHome, env, cwd, io, stdin, write } = params;
  const listen = params.listen ?? listenForKeys;
  const launch = params.launch ?? runLaunch;
  const add = params.add ?? addProfile;

  let config: Config | undefined;
  try {
    config = readConfig(cswitchHome);
  } catch (err) {
    process.stderr.write(`${(err as ConfigError).message}\n`);
    return EXIT_RUNTIME;
  }

  if (config === undefined) {
    const initCode = await runInit({ home, nameFlag: undefined, io, env });
    if (initCode !== EXIT_OK) {
      return initCode;
    }

    try {
      config = readConfig(cswitchHome);
    } catch (err) {
      process.stderr.write(`${(err as ConfigError).message}\n`);
      return EXIT_RUNTIME;
    }
    if (config === undefined) {
      return EXIT_RUNTIME;
    }
  }

  return runProfileListScreen({ home, cswitchHome, config, env, cwd, stdin, write, listen, launch, add });
}

interface ProfileListScreenParams {
  home: string;
  cswitchHome: string;
  config: Config;
  env: NodeJS.ProcessEnv;
  cwd: string;
  stdin: RawModeStdin;
  write: (text: string) => void;
  listen: typeof listenForKeys;
  launch: (params: RunLaunchParams) => Promise<number>;
  add: (params: AddProfileParams) => AddProfileOutcome;
}

/**
 * The Profile list (spec §10.5) and the add screen it opens with `a` (§10.6).
 * They share one keyboard listener and one loop rather than nesting a second
 * raw-mode session: which screen is showing is just state, so Ctrl-C and the
 * raw-mode restore keep working identically on both (spec §10.3).
 *
 * Select-run is not persistent: it calls the Launcher (§5) directly with no
 * state written and no Binding touched, then this screen (and `cswitch` with
 * it) ends when the launched `claude` does — Interactive Mode never reopens
 * itself (spec §10.5).
 */
function runProfileListScreen(params: ProfileListScreenParams): Promise<number> {
  const { home, cswitchHome, env, cwd, stdin, write, listen, launch, add } = params;

  let config = params.config;
  const report = buildStatusReport({ home, cswitchHome, config, cwd });
  let profiles = report.profiles;

  return new Promise((resolve) => {
    const here = report.here;
    let selectedIndex = here.kind === "resolved" ? profiles.findIndex((p) => p.name === here.profile) : 0;
    if (selectedIndex < 0) {
      selectedIndex = 0;
    }

    let screen: "list" | "add" = "list";
    let draftName = "";
    let addError: string | undefined;

    const render = () => {
      write(CLEAR_SCREEN);
      write(screen === "add" ? renderAddScreen(draftName, addError) : renderProfileList(profiles, selectedIndex));
    };
    render();

    const openList = () => {
      screen = "list";
      draftName = "";
      addError = undefined;
      render();
    };

    /**
     * Re-reads config.json after a successful add so the list the user comes
     * back to includes the new Profile (spec §10.6) — `add` wrote the file, and
     * this screen's in-memory copy is the one that is now stale.
     */
    const reloadAfterAdd = (addedName: string): boolean => {
      let reloaded: Config | undefined;
      try {
        reloaded = readConfig(cswitchHome);
      } catch (err) {
        process.stderr.write(`${(err as ConfigError).message}\n`);
        return false;
      }
      if (reloaded === undefined) {
        return false;
      }
      config = reloaded;
      profiles = buildStatusReport({ home, cswitchHome, config, cwd }).profiles;
      const addedIndex = profiles.findIndex((p) => p.name === addedName);
      selectedIndex = addedIndex >= 0 ? addedIndex : Math.min(selectedIndex, Math.max(profiles.length - 1, 0));
      return true;
    };

    const keyboard: KeyboardInput = listen(
      stdin,
      (key, char) => {
        if (screen === "add") {
          switch (key) {
            case "char":
              draftName += char ?? "";
              addError = undefined;
              render();
              return;
            case "backspace":
              draftName = draftName.slice(0, -1);
              addError = undefined;
              render();
              return;
            case "escape":
              // Esc cancels: no Profile is added, the draft name is dropped (spec §10.3).
              openList();
              return;
            case "enter": {
              // `addProfile` runs the same §6.1 name rules and the same conflict
              // check as `cswitch add`, so a bad name shows its message here and
              // the flow stays on this screen for a correction (spec §10.6).
              // The chain still does real I/O, and an exception thrown out of
              // this keypress handler would kill the process with raw mode left
              // on — an unusable terminal — so a failed mkdir/write is shown on
              // screen like any other add failure instead.
              let outcome: AddProfileOutcome;
              try {
                outcome = add({ home, name: draftName });
              } catch (err) {
                outcome = { ok: false, message: `cswitch: could not add "${draftName}": ${(err as Error).message}`, exitCode: EXIT_RUNTIME };
              }
              if (!outcome.ok) {
                addError = outcome.message;
                render();
                return;
              }
              if (!reloadAfterAdd(draftName)) {
                keyboard.stop();
                resolve(EXIT_RUNTIME);
                return;
              }
              openList();
              return;
            }
            default:
              return;
          }
        }

        if (key === "escape") {
          keyboard.stop();
          resolve(EXIT_OK);
          return;
        }
        if (key === "char" && char === "a") {
          screen = "add";
          draftName = "";
          addError = undefined;
          render();
          return;
        }
        if (profiles.length === 0) {
          return;
        }
        switch (key) {
          case "up":
            selectedIndex = (selectedIndex - 1 + profiles.length) % profiles.length;
            render();
            return;
          case "down":
            selectedIndex = (selectedIndex + 1) % profiles.length;
            render();
            return;
          case "enter": {
            const profile = profiles[selectedIndex]!;
            keyboard.stop();
            launch({
              home,
              cswitchHome,
              config,
              profileName: profile.name,
              quiet: false,
              command: ["claude"],
              env,
              cwd,
            }).then(resolve, (err: unknown) => {
              process.stderr.write(`cswitch: unexpected error while launching: ${(err as Error).message}\n`);
              resolve(EXIT_RUNTIME);
            });
            return;
          }
          default:
            // `d` is reserved for the remove screen (spec §10.7 — separate ticket).
            return;
        }
      },
      (code) => {
        keyboard.stop();
        resolve(code);
      },
    );
  });
}
