import { addProfile, type AddProfileOutcome, type AddProfileParams } from "./add.js";
import { ConfigError, readConfig, type Config, type ProfileRecord } from "./config.js";
import { EXIT_OK, EXIT_RUNTIME } from "./exit-codes.js";
import { LAUNCH_ACTIONS } from "./interactive-actions.js";
import type { Io } from "./io.js";
import { runInit } from "./init.js";
import { CLEAR_SCREEN, ENTER_ALT_SCREEN, HIDE_CURSOR, LEAVE_ALT_SCREEN, SHOW_CURSOR, renderAddScreen, renderProfileList, renderRemoveScreen } from "./interactive-view.js";
import { type KeyboardInput, type KeyName, type RawModeStdin, listenForKeys } from "./keyboard.js";
import { type RunLaunchParams, runLaunch } from "./launch.js";
import { listRecentRows, type RecentRow } from "./recent.js";
import { removeProfile, type RemoveProfileParams, type RemoveProfileResult } from "./remove.js";
import { buildStatusReport, type ProfileStatus } from "./status.js";
import { loadUsageLimits, type UsageLimits } from "./usage-limits.js";

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
  /** One Profile's Usage Limits (docs/adr/0003); injectable so tests never hit the network. */
  usageLimits?: (record: ProfileRecord) => Promise<UsageLimits | undefined>;
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
  const usageLimits = params.usageLimits ?? ((record: ProfileRecord) => loadUsageLimits({ home, cswitchHome, record, env }));

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

  return runProfileListScreen({ home, cswitchHome, config, env, cwd, stdin, write, listen, launch, add, remove, usageLimits });
}

/** What the list's cursor is on: a Profile, or a Recent Directory row (issue recent-directories/01, K4). */
type SelectedRow = { kind: "profile"; profile: ProfileStatus } | { kind: "recent"; recent: RecentRow };

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
  usageLimits: (record: ProfileRecord) => Promise<UsageLimits | undefined>;
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
  const { home, cswitchHome, env, cwd, stdin, write, listen, launch, add, remove, usageLimits } = params;

  let config = params.config;
  const report = buildStatusReport({ home, cswitchHome, config, cwd });
  let profiles = report.profiles;
  let recentRows = listRecentRows({ home, cswitchHome, config });
  // The cursor runs through the Profiles and then the Recent Directories as one
  // list (issue K4): indexes past the Profiles land on a Recent row.
  const rowCount = () => profiles.length + recentRows.length;
  // The one place that index is turned back into what it points at, so no key
  // handler does the offset arithmetic itself.
  const rowAt = (index: number): SelectedRow | undefined => {
    const profile = profiles[index];
    if (profile !== undefined) {
      return { kind: "profile", profile };
    }
    const recent = recentRows[index - profiles.length];
    return recent === undefined ? undefined : { kind: "recent", recent };
  };

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

    // Usage Limits by Profile name, filled in as answers arrive. `active` goes
    // false the moment this screen hands the terminal away — to a launched
    // `claude` or back to the shell — so a late answer can never draw over
    // whatever owns the terminal by then.
    const usage = new Map<string, UsageLimits>();
    let active = true;

    const renderCurrentScreen = (): string => {
      switch (screen) {
        case "add":
          return renderAddScreen(draftName, addError);
        case "remove":
          return renderRemoveScreen(removeTarget, removeError);
        case "list": {
          const now = Date.now();
          return renderProfileList(profiles, selectedIndex, listNotice, { rows: recentRows, home, now }, usage, now);
        }
      }
    };

    const render = () => {
      write(CLEAR_SCREEN);
      write(HIDE_CURSOR);
      write(renderCurrentScreen());
    };
    write(ENTER_ALT_SCREEN);
    try {
      render();
    } catch (err) {
      // The keyboard isn't listening yet, so there is nothing for
      // `releaseTerminal` to stop — only the screen and cursor to give back
      // before the error reaches the shell.
      write(LEAVE_ALT_SCREEN);
      write(SHOW_CURSOR);
      throw err;
    }

    // Usage Limits arrive from the network after the list is already up
    // (docs/adr/0003); see `usage` and `active` above.
    const fetchUsage = () => {
      for (const record of config.profiles) {
        void usageLimits(record).then(
          (limits) => {
            if (!active || limits === undefined) {
              return;
            }
            usage.set(record.name, limits);
            if (screen === "list") {
              guarded(render);
            }
          },
          () => {},
        );
      }
    };
    fetchUsage();

    /**
     * Gives the terminal back: stops the keyboard (restoring raw mode), leaves
     * the alternate screen and puts the cursor back before anything else — the
     * launched `claude`, the shell prompt after Esc, or a stderr message —
     * inherits the terminal.
     */
    const releaseTerminal = () => {
      active = false;
      keyboard.stop();
      write(LEAVE_ALT_SCREEN);
      write(SHOW_CURSOR);
    };

    /**
     * The single way out of this screen. An error message is written only after
     * the alternate screen is gone; written before, it would vanish with it.
     */
    const finish = (code: number, message?: string) => {
      releaseTerminal();
      if (message !== undefined) {
        process.stderr.write(`${message}\n`);
      }
      resolve(code);
    };

    /**
     * Runs a step that happens while the screen is up. A throw from it would
     * otherwise kill the process still on the alternate screen, in raw mode,
     * with the cursor hidden — so it ends the screen properly instead.
     */
    const guarded = (step: () => void) => {
      try {
        step();
      } catch (err) {
        finish(EXIT_RUNTIME, `cswitch: unexpected error: ${(err as Error).message}`);
      }
    };

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
     *
     * A failure carries its message back rather than printing it: the caller
     * hands it to `finish`, which prints it once the alternate screen is gone.
     */
    const reload = (focusName: string | undefined): { ok: true } | { ok: false; message?: string } => {
      let reloaded: Config | undefined;
      try {
        reloaded = readConfig(cswitchHome);
      } catch (err) {
        return { ok: false, message: (err as ConfigError).message };
      }
      if (reloaded === undefined) {
        return { ok: false };
      }
      config = reloaded;
      profiles = buildStatusReport({ home, cswitchHome, config, cwd }).profiles;
      recentRows = listRecentRows({ home, cswitchHome, config });
      const focusIndex = focusName === undefined ? -1 : profiles.findIndex((p) => p.name === focusName);
      selectedIndex = focusIndex >= 0 ? focusIndex : Math.min(selectedIndex, Math.max(rowCount() - 1, 0));
      return { ok: true };
    };

    /**
     * Select-run (spec §10.5): hands the selected Profile and a command line to
     * the Launcher, and ends this screen with whatever the child exits with —
     * for every key that starts something, Enter and the §10.3 launch keys
     * alike. The terminal is released before `claude` takes it over, so the
     * child never inherits a hidden cursor or the alternate screen. `finish`
     * can't be used here: the exit code is whatever the launch resolves to,
     * later.
     */
    const runInProfile = (command: string[]) => {
      const row = rowAt(selectedIndex);
      if (row === undefined) {
        return;
      }
      // A Recent row carries its own directory and Profile; the Profile wins
      // over that directory's Binding because it is named explicitly (ADR-0002).
      const profileName = row.kind === "profile" ? row.profile.name : row.recent.profile;
      const launchCwd = row.kind === "profile" ? cwd : row.recent.dir;
      releaseTerminal();
      launch({
        home,
        cswitchHome,
        config,
        profileName,
        quiet: false,
        command,
        env,
        cwd: launchCwd,
      }).then(resolve, (err: unknown) => {
        process.stderr.write(`cswitch: unexpected error while launching: ${(err as Error).message}\n`);
        resolve(EXIT_RUNTIME);
      });
    };

    const handleKey = (key: KeyName, char?: string) => {
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
            const reloaded = reload(draftName);
            if (!reloaded.ok) {
              finish(EXIT_RUNTIME, reloaded.message);
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
          const reloaded = reload(undefined);
          if (!reloaded.ok) {
            finish(EXIT_RUNTIME, reloaded.message);
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
        finish(EXIT_OK);
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
      if (rowCount() === 0) {
        return;
      }
      switch (key) {
        case "up":
          selectedIndex = (selectedIndex - 1 + rowCount()) % rowCount();
          listNotice = undefined;
          render();
          return;
        case "down":
          selectedIndex = (selectedIndex + 1) % rowCount();
          listNotice = undefined;
          render();
          return;
        case "enter":
          runInProfile(["claude"]);
          return;
        case "char": {
          // The Default Profile is never offered for removal, so `d` on it is
          // a no-op rather than a rejected confirmation — that is what keeps
          // `init`'s "never touches ~/.claude" promise (spec §10.7).
          //
          // A Recent row is no Profile at all: `d` there would delete a Profile
          // the user is not looking at, so it does nothing (issue K5).
          const row = rowAt(selectedIndex);
          if (char === "d" && row?.kind === "profile" && !row.profile.inPlace) {
            screen = "remove";
            removeTarget = row.profile.name;
            removeError = undefined;
            listNotice = undefined;
            render();
            return;
          }
          // The one-key launches (spec §10.3): the same select-run path Enter
          // takes, only with a different command line. They have no Default
          // Profile exception the way `d` does — none of them touches
          // `~/.claude`, they only start a process that reads it.
          const action = LAUNCH_ACTIONS.find((candidate) => candidate.key === char);
          if (action !== undefined) {
            runInProfile(action.command);
          }
          return;
        }
        default:
          return;
      }
    };

    const keyboard: KeyboardInput = listen(
      stdin,
      (key, char) => guarded(() => handleKey(key, char)),
      (code) => {
        finish(code);
      },
    );
  });
}
