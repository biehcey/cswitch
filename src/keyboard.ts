import readline from "node:readline";

export type KeyName = "up" | "down" | "enter" | "escape" | "a" | "d";

export interface KeyboardInput {
  stop(): void;
}

export type RawModeStdin = NodeJS.ReadableStream & {
  isTTY?: boolean;
  isRaw?: boolean;
  setRawMode?: (mode: boolean) => void;
};

/**
 * Raw-mode keyboard input (spec §10.8): zero-dependency, built on Node's own
 * `readline.emitKeypressEvents` + `setRawMode`. Translates arrows, Enter, Escape,
 * `a` and `d` into named events. Raw mode suppresses SIGINT, so Ctrl-C can never
 * reach a `'SIGINT'` handler — it is caught here in the `'keypress'` handler and
 * exits the process directly, on every screen, always (spec §10.3), rather than
 * relying on a signal that will never fire. `isTTY` is not checked here: whether
 * this module should run at all is the caller's call (spec §10.8).
 */
export function listenForKeys(
  stdin: RawModeStdin,
  onKey: (key: KeyName) => void,
  exit: (code: number) => void = process.exit,
): KeyboardInput {
  readline.emitKeypressEvents(stdin);

  const wasRaw = stdin.isRaw;
  if (typeof stdin.setRawMode === "function") {
    stdin.setRawMode(true);
  }
  stdin.resume();

  const handler = (_sequence: string, key: readline.Key | undefined) => {
    if (!key) {
      return;
    }
    if (key.ctrl && key.name === "c") {
      exit(0);
      return;
    }
    switch (key.name) {
      case "up":
        onKey("up");
        break;
      case "down":
        onKey("down");
        break;
      case "return":
        onKey("enter");
        break;
      case "escape":
        onKey("escape");
        break;
      case "a":
        onKey("a");
        break;
      case "d":
        onKey("d");
        break;
    }
  };

  stdin.on("keypress", handler);

  return {
    stop() {
      stdin.removeListener("keypress", handler);
      if (typeof stdin.setRawMode === "function") {
        stdin.setRawMode(wasRaw ?? false);
      }
      stdin.pause();
    },
  };
}
