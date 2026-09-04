import { ConfigError, readConfig, type Config } from "./config.js";
import { EXIT_OK, EXIT_RUNTIME } from "./exit-codes.js";
import type { Io } from "./io.js";
import { runInit } from "./init.js";
import { CLEAR_SCREEN, renderProfileList } from "./interactive-view.js";
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

  return runProfileListScreen({ home, cswitchHome, config, env, cwd, stdin, write, listen, launch });
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
}

/**
 * The Profile list and select-run screen (spec §10.5). Select-run is not
 * persistent: it calls the Launcher (§5) directly with no state written and no
 * Binding touched, then this screen (and `cswitch` with it) ends when the
 * launched `claude` does — Interactive Mode never reopens itself (spec §10.5).
 */
function runProfileListScreen(params: ProfileListScreenParams): Promise<number> {
  const { home, cswitchHome, config, env, cwd, stdin, write, listen, launch } = params;
  const report = buildStatusReport({ home, cswitchHome, config, cwd });
  const profiles = report.profiles;

  return new Promise((resolve) => {
    const here = report.here;
    let selectedIndex = here.kind === "resolved" ? profiles.findIndex((p) => p.name === here.profile) : 0;
    if (selectedIndex < 0) {
      selectedIndex = 0;
    }

    const render = () => {
      write(CLEAR_SCREEN);
      write(renderProfileList(profiles, selectedIndex));
    };
    render();

    const keyboard: KeyboardInput = listen(
      stdin,
      (key) => {
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
          case "escape":
            keyboard.stop();
            resolve(EXIT_OK);
            return;
          case "a":
          case "d":
            // Reserved for the add/remove screens (spec §10.6/§10.7 — separate tickets).
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
