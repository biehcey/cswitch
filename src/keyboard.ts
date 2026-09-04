import readline from "node:readline";

export type KeyName = "up" | "down" | "enter" | "escape" | "backspace" | "char";

export interface KeyboardInput {
  stop(): void;
}

export type RawModeStdin = NodeJS.ReadableStream & {
  isTTY?: boolean;
  isRaw?: boolean;
  setRawMode?: (mode: boolean) => void;
};

/** Printable ASCII, i.e. everything a profile name could legitimately be typed from. */
function printableChar(sequence: string, key: readline.Key): string | undefined {
  if (key.ctrl || key.meta || sequence.length !== 1) {
    return undefined;
  }
  const code = sequence.charCodeAt(0);
  return code >= 0x20 && code < 0x7f ? sequence : undefined;
}

/**
 * Raw-mode keyboard input (spec §10.8): zero-dependency, built on Node's own
 * `readline.emitKeypressEvents` + `setRawMode`. It reports what was pressed and
 * nothing more — a letter is always a `"char"`, never a named command, because
 * whether `a` means "add" or is the first letter of a profile name depends on
 * the screen, not the keyboard (spec §10.3 vs §10.6). Raw mode suppresses
 * SIGINT, so Ctrl-C can never reach a `'SIGINT'` handler — it is caught here in
 * the `'keypress'` handler and exits the process directly, on every screen,
 * always (spec §10.3), rather than relying on a signal that will never fire.
 * `isTTY` is not checked here: whether this module should run at all is the
 * caller's call (spec §10.8).
 */
export function listenForKeys(
  stdin: RawModeStdin,
  onKey: (key: KeyName, char?: string) => void,
  exit: (code: number) => void = process.exit,
): KeyboardInput {
  readline.emitKeypressEvents(stdin);

  const wasRaw = stdin.isRaw;
  if (typeof stdin.setRawMode === "function") {
    stdin.setRawMode(true);
  }
  stdin.resume();

  const handler = (sequence: string, key: readline.Key | undefined) => {
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
        return;
      case "down":
        onKey("down");
        return;
      case "return":
        onKey("enter");
        return;
      case "escape":
        onKey("escape");
        return;
      case "backspace":
      case "delete":
        onKey("backspace");
        return;
    }

    const char = printableChar(sequence ?? "", key);
    if (char !== undefined) {
      onKey("char", char);
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
