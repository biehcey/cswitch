import { addProfile, type AddProfileOutcome, type AddProfileParams } from "./add.js";
import { ConfigError, readConfig, type Config } from "./config.js";
import { EXIT_OK, EXIT_RUNTIME } from "./exit-codes.js";
import type { Io } from "./io.js";
import { runInit } from "./init.js";
import { CLEAR_SCREEN, renderAddScreen, renderProfileList, renderRemoveScreen } from "./interactive-view.js";
import { type KeyboardInput, type RawModeStdin, listenForKeys } from "./keyboard.js";
import { type RunLaunchParams, runLaunch } from "./launch.js";
import { removeProfile, type RemoveProfileParams, type RemoveProfileResult } from "./remove.js";
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
  remove?: (params: RemoveProfileParams) => RemoveProfileResult;
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
  const remove = params.remove ?? removeProfile;

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

  return runProfileListScreen({ home, cswitchHome, config, env, cwd, stdin, write, listen, launch, add, remove });
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
  remove: (params: RemoveProfileParams) => RemoveProfileResult;
}

/**
 * The Profile list (spec §10.5) and the two screens it opens: add with `a`
 * (§10.6) and the remove confirmation with `d` (§10.7). They share one keyboard
 * listener and one loop rather than nesting further raw-mode sessions: which
 * screen is showing is just state, so Ctrl-C and the raw-mode restore keep
 * working identically on all of them (spec §10.3).
 *
 * Select-run is not persistent: it calls the Launcher (§5) directly with no
 * state written and no Binding touched, then this screen (and `cswitch` with
 * it) ends when the launched `claude` does — Interactive Mode never reopens
 * itself (spec §10.5).
 */
function runProfileListScreen(params: ProfileListScreenParams): Promise<number> {
  const { home, cswitchHome, env, cwd, stdin, write, listen, launch, add, remove } = params;

  let config = params.config;
  const report = buildStatusReport({ home, cswitchHome, config, cwd });
  let profiles = report.profiles;

  return new Promise((resolve) => {
    const here = report.here;
    let selectedIndex = here.kind === "resolved" ? profiles.findIndex((p) => p.name === here.profile) : 0;
    if (selectedIndex < 0) {
      selectedIndex = 0;
    }

    let screen: "list" | "add" | "remove" = "list";
    let draftName = "";
    let addError: string | undefined;
    // The profile the open confirmation is about, captured when `d` was pressed
    // so a later re-render can never retarget it at whatever is selected now.
    let removeTarget = "";
    let removeError: string | undefined;
    let listNotice: string | undefined;

    const renderCurrentScreen = (): string => {
      switch (screen) {
        case "add":
          return renderAddScreen(draftName, addError);
        case "remove":
          return renderRemoveScreen(removeTarget, removeError);
        case "list":
          return renderProfileList(profiles, selectedIndex, listNotice);
      }
    };

    const render = () => {
      write(CLEAR_SCREEN);
      write(renderCurrentScreen());
    };
    render();

    // Deliberately leaves `listNotice` alone: a notice is set by the caller that
    // is on its way back here, and clearing it would erase the message this
    // return is carrying.
    const openList = () => {
      screen = "list";
      draftName = "";
      addError = undefined;
      removeTarget = "";
      removeError = undefined;
      render();
    };

    /**
     * Re-reads config.json after an add or a removal so the list the user comes
     * back to matches what is now on disk (spec §10.6/§10.7) — `add` and
     * `removeProfile` both wrote the file, and this screen's in-memory copy is
     * the one that is now stale. `focusName` is the Profile to select
     * afterwards; a removal has no such Profile, so selection is clamped back
     * into the shortened list instead.
     */
    const reload = (focusName: string | undefined): boolean => {
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
      const focusIndex = focusName === undefined ? -1 : profiles.findIndex((p) => p.name === focusName);
      selectedIndex = focusIndex >= 0 ? focusIndex : Math.min(selectedIndex, Math.max(profiles.length - 1, 0));
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
              if (!reload(draftName)) {
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

        if (screen === "remove") {
          // Only y/n/Esc mean anything here; every other key is ignored so a
          // stray press can never be read as consent (spec §10.7).
          const answer = key === "char" ? char?.toLowerCase() : undefined;
          if (key === "escape" || answer === "n") {
            openList();
            return;
          }
          if (answer === "y") {
            // The same `removeProfile()` the flag-based `cswitch remove` calls —
            // one code path, so ordering, atomicity, Binding cleanup and the
            // best-effort Keychain step are identical here (spec §6.4/§10.7).
            // As on the add screen, a thrown I/O error would kill the process
            // with raw mode still on, so it is shown in place instead.
            let result: RemoveProfileResult;
            try {
              result = remove({ home, name: removeTarget });
            } catch (err) {
              result = { kind: "error", exitCode: EXIT_RUNTIME, message: `cswitch: could not remove "${removeTarget}": ${(err as Error).message}` };
            }
            if (result.kind === "error") {
              removeError = result.message;
              render();
              return;
            }
            if (!reload(undefined)) {
              keyboard.stop();
              resolve(EXIT_RUNTIME);
              return;
            }
            // The removal already happened, so a best-effort warning has nowhere
            // left to go: it rides back to the list rather than being wiped by
            // the redraw (the flag-based `remove` prints it to stderr instead).
            // Set before `openList()` so the list is drawn once, with it.
            listNotice = result.warning;
            openList();
            return;
          }
          return;
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
          listNotice = undefined;
          render();
          return;
        }
        if (profiles.length === 0) {
          return;
        }
        switch (key) {
          case "up":
            selectedIndex = (selectedIndex - 1 + profiles.length) % profiles.length;
            listNotice = undefined;
            render();
            return;
          case "down":
            selectedIndex = (selectedIndex + 1) % profiles.length;
            listNotice = undefined;
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
          case "char":
            // The Default Profile is never offered for removal, so `d` on it is
            // a no-op rather than a rejected confirmation — that is what keeps
            // `init`'s "never touches ~/.claude" promise (spec §10.7).
            if (char === "d" && !profiles[selectedIndex]!.inPlace) {
              screen = "remove";
              removeTarget = profiles[selectedIndex]!.name;
              removeError = undefined;
              listNotice = undefined;
              render();
            }
            return;
          default:
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
