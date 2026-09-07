import assert from "node:assert/strict";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import test from "node:test";
import { cswitchHomePath } from "../src/config.js";
import { EXIT_OK } from "../src/exit-codes.js";
import type { Io } from "../src/io.js";
import { HIDE_CURSOR, SHOW_CURSOR } from "../src/interactive-view.js";
import { LAUNCH_ACTIONS } from "../src/interactive-actions.js";
import { runInteractive } from "../src/interactive.js";
import type { RunLaunchParams } from "../src/launch.js";

async function withFakeHome(fn: (home: string) => Promise<void>): Promise<void> {
  const home = mkdtempSync(path.join(os.tmpdir(), "cswitch-interactive-test-"));
  try {
    await fn(home);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

function fakeIo(overrides: Partial<Io> = {}): Io {
  return {
    write: () => {},
    isTTY: false,
    question: async () => "",
    ...overrides,
  };
}

function fakeStdin(): PassThrough & { isTTY?: boolean; setRawMode?: (mode: boolean) => void } {
  return new PassThrough() as PassThrough & { isTTY?: boolean; setRawMode?: (mode: boolean) => void };
}

async function settle(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
}

function seedExistingProfiles(home: string, names: string[]): void {
  const cswitchHome = cswitchHomePath(home);
  mkdirSync(path.join(cswitchHome, "profiles"), { recursive: true });
  writeFileSync(
    path.join(cswitchHome, "config.json"),
    JSON.stringify({
      version: 1,
      profiles: names.map((name, i) => (i === 0 ? { name, inPlace: true } : { name })),
      bindings: [],
    }),
  );
}

test("runInteractive: with no ~/.cswitch, runs the setup wizard and then shows the Profile list", async () => {
  await withFakeHome(async (home) => {
    const written: string[] = [];
    const stdin = fakeStdin();

    const resultPromise = runInteractive({
      home,
      cswitchHome: cswitchHomePath(home),
      env: {},
      cwd: home,
      io: fakeIo(),
      stdin,
      write: (text) => written.push(text),
    });

    await settle();
    stdin.write("\x1b");
    const code = await resultPromise;

    assert.equal(code, EXIT_OK);
    // the wizard actually ran cswitch init's logic: config.json now exists with a default profile
    const config = JSON.parse(readFileSync(path.join(cswitchHomePath(home), "config.json"), "utf8"));
    assert.equal(config.profiles[0].inPlace, true);
    // and the list screen rendered afterwards
    assert.ok(written.some((chunk) => /PROFILE/.test(chunk)));
  });
});

test("runInteractive: with an existing config, skips the wizard and renders the Profile list directly", async () => {
  await withFakeHome(async (home) => {
    seedExistingProfiles(home, ["default", "work"]);
    const written: string[] = [];
    const stdin = fakeStdin();

    const resultPromise = runInteractive({
      home,
      cswitchHome: cswitchHomePath(home),
      env: {},
      cwd: home,
      io: fakeIo(),
      stdin,
      write: (text) => written.push(text),
    });

    await settle();
    stdin.write("\x1b");
    const code = await resultPromise;

    assert.equal(code, EXIT_OK);
    assert.ok(written.some((chunk) => chunk.includes("default")));
    assert.ok(written.some((chunk) => chunk.includes("work")));
  });
});

test("runInteractive: Enter launches the selected profile via the Launcher, with no persistent state written", async () => {
  await withFakeHome(async (home) => {
    seedExistingProfiles(home, ["default", "work"]);
    const stdin = fakeStdin();
    const launchCalls: RunLaunchParams[] = [];

    const resultPromise = runInteractive({
      home,
      cswitchHome: cswitchHomePath(home),
      env: {},
      cwd: home,
      io: fakeIo(),
      stdin,
      write: () => {},
      launch: async (params) => {
        launchCalls.push(params);
        return 7;
      },
    });

    await settle();
    stdin.write("\x1b[B"); // down: default -> work
    await settle();
    stdin.write("\r"); // enter: run "work"
    const code = await resultPromise;

    assert.equal(code, 7);
    assert.equal(launchCalls.length, 1);
    assert.equal(launchCalls[0]!.profileName, "work");
    assert.deepEqual(launchCalls[0]!.command, ["claude"]);
    assert.equal(launchCalls[0]!.quiet, false);

    // select-run is not persistent: config.json is untouched
    const config = JSON.parse(readFileSync(path.join(cswitchHomePath(home), "config.json"), "utf8"));
    assert.deepEqual(config.bindings, []);
  });
});

test("runInteractive: Escape at the list (top screen) exits with code 0, without launching anything", async () => {
  await withFakeHome(async (home) => {
    seedExistingProfiles(home, ["default"]);
    const stdin = fakeStdin();
    let launched = false;

    const resultPromise = runInteractive({
      home,
      cswitchHome: cswitchHomePath(home),
      env: {},
      cwd: home,
      io: fakeIo(),
      stdin,
      write: () => {},
      launch: async () => {
        launched = true;
        return 0;
      },
    });

    await settle();
    stdin.write("\x1b");
    const code = await resultPromise;

    assert.equal(code, EXIT_OK);
    assert.equal(launched, false);
  });
});

test("runInteractive: Ctrl-C exits immediately with code 0, without launching anything", async () => {
  await withFakeHome(async (home) => {
    seedExistingProfiles(home, ["default"]);
    const stdin = fakeStdin();
    let launched = false;

    const resultPromise = runInteractive({
      home,
      cswitchHome: cswitchHomePath(home),
      env: {},
      cwd: home,
      io: fakeIo(),
      stdin,
      write: () => {},
      launch: async () => {
        launched = true;
        return 0;
      },
    });

    await settle();
    stdin.write("\x03");
    const code = await resultPromise;

    assert.equal(code, 0);
    assert.equal(launched, false);
  });
});

// Node's readline waits ~500ms to decide a lone ESC is not the start of a longer
// escape sequence, so an Escape must be given room to land before the next key
// is sent — otherwise the two coalesce and one of them is lost.
const ESCAPE_SETTLE_MS = 600;

async function pressEscape(stdin: PassThrough): Promise<void> {
  stdin.write("\x1b");
  await new Promise((resolve) => setTimeout(resolve, ESCAPE_SETTLE_MS));
}

async function type(stdin: PassThrough, text: string): Promise<void> {
  for (const char of text) {
    stdin.write(char);
    await settle();
  }
}

test("runInteractive: 'a' opens the name prompt, and a valid name runs the real add chain", async () => {
  await withFakeHome(async (home) => {
    seedExistingProfiles(home, ["default"]);
    const written: string[] = [];
    const stdin = fakeStdin();

    const resultPromise = runInteractive({
      home,
      cswitchHome: cswitchHomePath(home),
      env: {},
      cwd: home,
      io: fakeIo(),
      stdin,
      write: (text) => written.push(text),
      launch: async () => 0,
    });

    await settle();
    stdin.write("a");
    await settle();
    assert.ok(written.some((chunk) => chunk.includes("new profile")), "the add screen should be showing");

    await type(stdin, "work");
    stdin.write("\r");
    await settle();
    stdin.write("\x1b"); // back at the list: quit
    const code = await resultPromise;

    assert.equal(code, EXIT_OK);

    // the real add chain ran: directory, plugins/ junction, and the config record
    const profileDir = path.join(cswitchHomePath(home), "profiles", "work");
    assert.ok(existsSync(profileDir), "profile directory should exist");
    assert.ok(lstatSync(path.join(profileDir, "plugins")).isSymbolicLink(), "plugins/ should be junctioned");
    const config = JSON.parse(readFileSync(path.join(cswitchHomePath(home), "config.json"), "utf8"));
    assert.ok(config.profiles.some((p: { name: string }) => p.name === "work"));
  });
});

test("runInteractive: after a successful add, returns to the Profile list including the new profile", async () => {
  await withFakeHome(async (home) => {
    seedExistingProfiles(home, ["default"]);
    const written: string[] = [];
    const stdin = fakeStdin();

    const resultPromise = runInteractive({
      home,
      cswitchHome: cswitchHomePath(home),
      env: {},
      cwd: home,
      io: fakeIo(),
      stdin,
      write: (text) => written.push(text),
      launch: async () => 0,
    });

    await settle();
    stdin.write("a");
    await settle();
    await type(stdin, "work");
    stdin.write("\r");
    await settle();

    const afterAdd = written.at(-1)!;
    assert.match(afterAdd, /PROFILE/, "should be back on the list screen");
    assert.match(afterAdd, /work/, "the new profile should be listed");
    assert.match(afterAdd, /default/);

    stdin.write("\x1b");
    assert.equal(await resultPromise, EXIT_OK);
  });
});

test("runInteractive: an invalid name is reported on the add screen and the flow stays there", async () => {
  await withFakeHome(async (home) => {
    seedExistingProfiles(home, ["default"]);
    const written: string[] = [];
    const stdin = fakeStdin();

    const resultPromise = runInteractive({
      home,
      cswitchHome: cswitchHomePath(home),
      env: {},
      cwd: home,
      io: fakeIo(),
      stdin,
      write: (text) => written.push(text),
      launch: async () => 0,
    });

    await settle();
    stdin.write("a");
    await settle();
    await type(stdin, "Work"); // uppercase: rejected by the §6.1 name rules
    stdin.write("\r");
    await settle();

    const afterSubmit = written.at(-1)!;
    assert.match(afterSubmit, /is not a valid profile name/);
    assert.match(afterSubmit, /new profile/, "should still be on the add screen for a correction");
    assert.doesNotMatch(afterSubmit, /PROFILE/, "should not have fallen back to the list");

    // nothing was created for the rejected name
    assert.equal(existsSync(path.join(cswitchHomePath(home), "profiles", "Work")), false);

    await pressEscape(stdin);
    await pressEscape(stdin);
    assert.equal(await resultPromise, EXIT_OK);
  });
});

test("runInteractive: a name that collides with an existing profile is shown as an error, not a crash", async () => {
  await withFakeHome(async (home) => {
    seedExistingProfiles(home, ["default", "work"]);
    const written: string[] = [];
    const stdin = fakeStdin();

    const resultPromise = runInteractive({
      home,
      cswitchHome: cswitchHomePath(home),
      env: {},
      cwd: home,
      io: fakeIo(),
      stdin,
      write: (text) => written.push(text),
      launch: async () => 0,
    });

    await settle();
    stdin.write("a");
    await settle();
    await type(stdin, "work");
    stdin.write("\r");
    await settle();

    const afterSubmit = written.at(-1)!;
    assert.match(afterSubmit, /already exists/);
    assert.match(afterSubmit, /new profile/, "the flow should not be broken by the conflict");

    // the existing profile is untouched: still exactly one "work" record
    const config = JSON.parse(readFileSync(path.join(cswitchHomePath(home), "config.json"), "utf8"));
    assert.equal(config.profiles.filter((p: { name: string }) => p.name === "work").length, 1);

    await pressEscape(stdin);
    await pressEscape(stdin);
    assert.equal(await resultPromise, EXIT_OK);
  });
});

test("runInteractive: Escape on the add screen returns to the list without adding a profile", async () => {
  await withFakeHome(async (home) => {
    seedExistingProfiles(home, ["default"]);
    const written: string[] = [];
    const stdin = fakeStdin();

    const resultPromise = runInteractive({
      home,
      cswitchHome: cswitchHomePath(home),
      env: {},
      cwd: home,
      io: fakeIo(),
      stdin,
      write: (text) => written.push(text),
      launch: async () => 0,
    });

    await settle();
    stdin.write("a");
    await settle();
    await type(stdin, "work");
    await pressEscape(stdin); // cancel

    assert.match(written.at(-1)!, /PROFILE/, "Escape should return to the list");

    // no profile was added
    assert.equal(existsSync(path.join(cswitchHomePath(home), "profiles", "work")), false);
    const config = JSON.parse(readFileSync(path.join(cswitchHomePath(home), "config.json"), "utf8"));
    assert.equal(config.profiles.length, 1);

    // and Escape again, now at the top screen, quits
    stdin.write("\x1b");
    assert.equal(await resultPromise, EXIT_OK);
  });
});

test("runInteractive: Backspace corrects the draft name before it is submitted", async () => {
  await withFakeHome(async (home) => {
    seedExistingProfiles(home, ["default"]);
    const stdin = fakeStdin();
    const addCalls: string[] = [];

    const resultPromise = runInteractive({
      home,
      cswitchHome: cswitchHomePath(home),
      env: {},
      cwd: home,
      io: fakeIo(),
      stdin,
      write: () => {},
      launch: async () => 0,
      add: ({ name }) => {
        addCalls.push(name);
        return { ok: false, message: "cswitch: stubbed", exitCode: 64 };
      },
    });

    await settle();
    stdin.write("a");
    await settle();
    await type(stdin, "workk");
    stdin.write("\x7f"); // backspace
    await settle();
    stdin.write("\r");
    await settle();

    assert.deepEqual(addCalls, ["work"]);

    await pressEscape(stdin);
    await pressEscape(stdin);
    assert.equal(await resultPromise, EXIT_OK);
  });
});

test("runInteractive: a re-opened add screen starts from an empty name, not the previous draft", async () => {
  await withFakeHome(async (home) => {
    seedExistingProfiles(home, ["default"]);
    const written: string[] = [];
    const stdin = fakeStdin();

    const resultPromise = runInteractive({
      home,
      cswitchHome: cswitchHomePath(home),
      env: {},
      cwd: home,
      io: fakeIo(),
      stdin,
      write: (text) => written.push(text),
      launch: async () => 0,
    });

    await settle();
    stdin.write("a");
    await settle();
    await type(stdin, "work");
    await pressEscape(stdin); // cancel
    stdin.write("a"); // reopen
    await settle();

    assert.doesNotMatch(written.at(-1)!, /work/, "the abandoned draft should be gone");

    await pressEscape(stdin);
    await pressEscape(stdin);
    assert.equal(await resultPromise, EXIT_OK);
  });
});

test("runInteractive: an I/O failure inside the add chain is shown on screen, not thrown out of the key handler", async () => {
  await withFakeHome(async (home) => {
    seedExistingProfiles(home, ["default"]);
    const written: string[] = [];
    const stdin = fakeStdin();

    const resultPromise = runInteractive({
      home,
      cswitchHome: cswitchHomePath(home),
      env: {},
      cwd: home,
      io: fakeIo(),
      stdin,
      write: (text) => written.push(text),
      launch: async () => 0,
      // stands in for a real EACCES/ENOSPC out of mkdirSync or writeConfig: an
      // escaping exception would kill the process with raw mode still enabled
      add: () => {
        throw new Error("EACCES: permission denied, mkdir");
      },
    });

    await settle();
    stdin.write("a");
    await settle();
    await type(stdin, "work");
    stdin.write("\r");
    await settle();

    const afterSubmit = written.at(-1)!;
    assert.match(afterSubmit, /EACCES: permission denied/);
    assert.match(afterSubmit, /new profile/, "the flow should survive the failure");

    // the screen is still live and Escape still works, so raw mode is restored on exit
    await pressEscape(stdin);
    await pressEscape(stdin);
    assert.equal(await resultPromise, EXIT_OK);
  });
});

function seedConfig(home: string, config: unknown): void {
  const cswitchHome = cswitchHomePath(home);
  mkdirSync(path.join(cswitchHome, "profiles"), { recursive: true });
  writeFileSync(path.join(cswitchHome, "config.json"), JSON.stringify(config));
}

function readStoredConfig(home: string): { profiles: { name: string }[]; bindings: { prefix: string; profile: string }[] } {
  return JSON.parse(readFileSync(path.join(cswitchHomePath(home), "config.json"), "utf8"));
}

test("runInteractive: 'd' on a normal profile opens the remove confirmation, worded exactly as the flag-based remove", async () => {
  await withFakeHome(async (home) => {
    seedExistingProfiles(home, ["default", "work"]);
    const written: string[] = [];
    const stdin = fakeStdin();

    const resultPromise = runInteractive({
      home,
      cswitchHome: cswitchHomePath(home),
      env: {},
      cwd: home,
      io: fakeIo(),
      stdin,
      write: (text) => written.push(text),
      launch: async () => 0,
    });

    await settle();
    stdin.write("\x1b[B"); // down: default -> work
    await settle();
    stdin.write("d");
    await settle();

    assert.match(written.at(-1)!, /delete work\? this cannot be undone \(y\/n\)/);

    await pressEscape(stdin);
    await pressEscape(stdin);
    assert.equal(await resultPromise, EXIT_OK);
  });
});

test("runInteractive: 'y' runs the same removeProfile the flag-based remove runs, and the list comes back without it", async () => {
  await withFakeHome(async (home) => {
    seedConfig(home, {
      version: 1,
      profiles: [{ name: "default", inPlace: true }, { name: "work" }],
      bindings: [
        { prefix: "/repos/a", profile: "work" },
        { prefix: "/repos/b", profile: "default" },
      ],
    });
    mkdirSync(path.join(cswitchHomePath(home), "profiles", "work"), { recursive: true });
    writeFileSync(path.join(cswitchHomePath(home), "profiles", "work", "marker"), "x");

    const written: string[] = [];
    const stdin = fakeStdin();

    const resultPromise = runInteractive({
      home,
      cswitchHome: cswitchHomePath(home),
      env: {},
      cwd: home,
      io: fakeIo(),
      stdin,
      write: (text) => written.push(text),
      launch: async () => 0,
    });

    await settle();
    stdin.write("\x1b[B");
    await settle();
    stdin.write("d");
    await settle();
    stdin.write("y");
    await settle();

    // the real removal chain ran: config record, bindings and the physical directory
    const config = readStoredConfig(home);
    assert.deepEqual(
      config.profiles.map((p) => p.name),
      ["default"],
    );
    assert.deepEqual(config.bindings, [{ prefix: "/repos/b", profile: "default" }]);
    assert.equal(existsSync(path.join(cswitchHomePath(home), "profiles", "work")), false);

    // and the list was re-rendered without the removed profile
    const afterRemove = written.at(-1)!;
    assert.match(afterRemove, /PROFILE/);
    assert.match(afterRemove, /default/);
    assert.doesNotMatch(afterRemove, /work/);

    stdin.write("\x1b");
    assert.equal(await resultPromise, EXIT_OK);
  });
});

test("runInteractive: 'n' at the confirmation removes nothing and returns to the list", async () => {
  await withFakeHome(async (home) => {
    seedExistingProfiles(home, ["default", "work"]);
    const written: string[] = [];
    const stdin = fakeStdin();
    const removeCalls: string[] = [];

    const resultPromise = runInteractive({
      home,
      cswitchHome: cswitchHomePath(home),
      env: {},
      cwd: home,
      io: fakeIo(),
      stdin,
      write: (text) => written.push(text),
      launch: async () => 0,
      remove: ({ name }) => {
        removeCalls.push(name);
        return { kind: "ok" };
      },
    });

    await settle();
    stdin.write("\x1b[B");
    await settle();
    stdin.write("d");
    await settle();
    stdin.write("n");
    await settle();

    assert.deepEqual(removeCalls, []);
    assert.match(written.at(-1)!, /PROFILE/, "should be back on the list");
    assert.equal(readStoredConfig(home).profiles.length, 2);

    stdin.write("\x1b");
    assert.equal(await resultPromise, EXIT_OK);
  });
});

test("runInteractive: Escape at the confirmation removes nothing and returns to the list", async () => {
  await withFakeHome(async (home) => {
    seedExistingProfiles(home, ["default", "work"]);
    const written: string[] = [];
    const stdin = fakeStdin();
    const removeCalls: string[] = [];

    const resultPromise = runInteractive({
      home,
      cswitchHome: cswitchHomePath(home),
      env: {},
      cwd: home,
      io: fakeIo(),
      stdin,
      write: (text) => written.push(text),
      launch: async () => 0,
      remove: ({ name }) => {
        removeCalls.push(name);
        return { kind: "ok" };
      },
    });

    await settle();
    stdin.write("\x1b[B");
    await settle();
    stdin.write("d");
    await settle();
    await pressEscape(stdin);

    assert.deepEqual(removeCalls, []);
    assert.match(written.at(-1)!, /PROFILE/, "should be back on the list");
    assert.equal(readStoredConfig(home).profiles.length, 2);

    stdin.write("\x1b");
    assert.equal(await resultPromise, EXIT_OK);
  });
});

test("runInteractive: 'd' on the Default profile does nothing — the remove screen never opens", async () => {
  await withFakeHome(async (home) => {
    seedExistingProfiles(home, ["default", "work"]);
    const written: string[] = [];
    const stdin = fakeStdin();
    const removeCalls: string[] = [];

    const resultPromise = runInteractive({
      home,
      cswitchHome: cswitchHomePath(home),
      env: {},
      cwd: home,
      io: fakeIo(),
      stdin,
      write: (text) => written.push(text),
      launch: async () => 0,
      remove: ({ name }) => {
        removeCalls.push(name);
        return { kind: "ok" };
      },
    });

    await settle();
    stdin.write("d"); // "default" is selected: in-place, never offered for removal
    await settle();
    stdin.write("y"); // and 'y' cannot land on a confirmation that was never opened
    await settle();

    assert.deepEqual(removeCalls, []);
    assert.ok(
      written.every((chunk) => !/this cannot be undone/.test(chunk)),
      "no confirmation should ever have rendered",
    );
    assert.equal(readStoredConfig(home).profiles.length, 2);

    stdin.write("\x1b");
    assert.equal(await resultPromise, EXIT_OK);
  });
});

test("runInteractive: a removal error is shown on the confirmation screen instead of crashing the key handler", async () => {
  await withFakeHome(async (home) => {
    seedExistingProfiles(home, ["default", "work"]);
    const written: string[] = [];
    const stdin = fakeStdin();

    const resultPromise = runInteractive({
      home,
      cswitchHome: cswitchHomePath(home),
      env: {},
      cwd: home,
      io: fakeIo(),
      stdin,
      write: (text) => written.push(text),
      launch: async () => 0,
      // stands in for a real EACCES out of the config write or the directory delete
      remove: () => {
        throw new Error("EACCES: permission denied, unlink");
      },
    });

    await settle();
    stdin.write("\x1b[B");
    await settle();
    stdin.write("d");
    await settle();
    stdin.write("y");
    await settle();

    assert.match(written.at(-1)!, /EACCES: permission denied/);
    assert.equal(readStoredConfig(home).profiles.length, 2);

    await pressEscape(stdin);
    await pressEscape(stdin);
    assert.equal(await resultPromise, EXIT_OK);
  });
});

test("runInteractive: a best-effort warning from removeProfile survives the redraw as a notice on the list", async () => {
  await withFakeHome(async (home) => {
    seedExistingProfiles(home, ["default", "work"]);
    const written: string[] = [];
    const stdin = fakeStdin();

    const resultPromise = runInteractive({
      home,
      cswitchHome: cswitchHomePath(home),
      env: {},
      cwd: home,
      io: fakeIo(),
      stdin,
      write: (text) => written.push(text),
      launch: async () => 0,
      remove: ({ name }) => {
        const config = readStoredConfig(home);
        writeFileSync(
          path.join(cswitchHomePath(home), "config.json"),
          JSON.stringify({ ...config, profiles: config.profiles.filter((p) => p.name !== name) }),
        );
        return { kind: "ok", warning: 'cswitch: could not delete the Keychain entry for "work"' };
      },
    });

    await settle();
    stdin.write("\x1b[B");
    await settle();
    stdin.write("d");
    await settle();
    stdin.write("y");
    await settle();

    assert.match(written.at(-1)!, /could not delete the Keychain entry/);
    assert.match(written.at(-1)!, /PROFILE/, "the notice sits under the list, it does not replace it");

    stdin.write("\x1b");
    assert.equal(await resultPromise, EXIT_OK);
  });
});

test("runInteractive: a shifted 'Y' confirms too, matching the flag-based remove's case-insensitive answer", async () => {
  await withFakeHome(async (home) => {
    seedExistingProfiles(home, ["default", "work"]);
    const stdin = fakeStdin();
    const removeCalls: string[] = [];

    const resultPromise = runInteractive({
      home,
      cswitchHome: cswitchHomePath(home),
      env: {},
      cwd: home,
      io: fakeIo(),
      stdin,
      write: () => {},
      launch: async () => 0,
      remove: ({ name }) => {
        removeCalls.push(name);
        const config = readStoredConfig(home);
        writeFileSync(
          path.join(cswitchHomePath(home), "config.json"),
          JSON.stringify({ ...config, profiles: config.profiles.filter((p) => p.name !== name) }),
        );
        return { kind: "ok" };
      },
    });

    await settle();
    stdin.write("\x1b[B");
    await settle();
    stdin.write("d");
    await settle();
    stdin.write("Y");
    await settle();

    assert.deepEqual(removeCalls, ["work"]);

    stdin.write("\x1b");
    assert.equal(await resultPromise, EXIT_OK);
  });
});

test("runInteractive: a removal warning is retired once the user moves on in the list", async () => {
  await withFakeHome(async (home) => {
    seedExistingProfiles(home, ["default", "work", "spare"]);
    const written: string[] = [];
    const stdin = fakeStdin();

    const resultPromise = runInteractive({
      home,
      cswitchHome: cswitchHomePath(home),
      env: {},
      cwd: home,
      io: fakeIo(),
      stdin,
      write: (text) => written.push(text),
      launch: async () => 0,
      remove: ({ name }) => {
        const config = readStoredConfig(home);
        writeFileSync(
          path.join(cswitchHomePath(home), "config.json"),
          JSON.stringify({ ...config, profiles: config.profiles.filter((p) => p.name !== name) }),
        );
        return { kind: "ok", warning: "cswitch: keychain entry left behind" };
      },
    });

    await settle();
    stdin.write("\x1b[B");
    await settle();
    stdin.write("d");
    await settle();
    stdin.write("y");
    await settle();

    assert.match(written.at(-1)!, /keychain entry left behind/);

    stdin.write("\x1b[B"); // move on: the warning belongs to the removal, not to what comes next
    await settle();
    assert.doesNotMatch(written.at(-1)!, /keychain entry left behind/);

    stdin.write("\x1b");
    assert.equal(await resultPromise, EXIT_OK);
  });
});

test("runInteractive: hides the terminal cursor while a screen is up and restores it on quit", async () => {
  await withFakeHome(async (home) => {
    seedExistingProfiles(home, ["default", "work"]);
    const written: string[] = [];
    const stdin = fakeStdin();

    const resultPromise = runInteractive({
      home,
      cswitchHome: cswitchHomePath(home),
      env: {},
      cwd: home,
      io: fakeIo(),
      stdin,
      write: (text) => written.push(text),
    });

    await settle();
    const beforeQuit = written.join("");
    assert.ok(beforeQuit.includes(HIDE_CURSOR), "the list screen hides the cursor");
    assert.ok(!beforeQuit.includes(SHOW_CURSOR), "and keeps it hidden while the list is up");

    stdin.write("\x1b");
    assert.equal(await resultPromise, EXIT_OK);
    assert.ok(written.join("").endsWith(SHOW_CURSOR), "Esc puts the cursor back last of all");
  });
});

test("runInteractive: restores the cursor before handing the terminal to the launched claude", async () => {
  await withFakeHome(async (home) => {
    seedExistingProfiles(home, ["default"]);
    const written: string[] = [];
    let cursorShownBeforeLaunch = false;
    const stdin = fakeStdin();

    const resultPromise = runInteractive({
      home,
      cswitchHome: cswitchHomePath(home),
      env: {},
      cwd: home,
      io: fakeIo(),
      stdin,
      write: (text) => written.push(text),
      launch: async () => {
        cursorShownBeforeLaunch = written.join("").endsWith(SHOW_CURSOR);
        return EXIT_OK;
      },
    });

    await settle();
    stdin.write("\r");
    assert.equal(await resultPromise, EXIT_OK);
    assert.ok(cursorShownBeforeLaunch);
  });
});

test("runInteractive: restores the cursor on Ctrl-C, from any screen", async () => {
  await withFakeHome(async (home) => {
    seedExistingProfiles(home, ["default"]);
    const written: string[] = [];
    const stdin = fakeStdin();

    const resultPromise = runInteractive({
      home,
      cswitchHome: cswitchHomePath(home),
      env: {},
      cwd: home,
      io: fakeIo(),
      stdin,
      write: (text) => written.push(text),
    });

    await settle();
    stdin.write("a"); // the add screen, which draws its own `_` caret
    await settle();
    assert.ok(!written.join("").includes(SHOW_CURSOR));

    stdin.write("\x03");
    assert.equal(await resultPromise, EXIT_OK);
    assert.ok(written.join("").endsWith(SHOW_CURSOR));
  });
});

for (const action of LAUNCH_ACTIONS) {
  test(`runInteractive: "${action.key}" launches the selected profile with ${JSON.stringify(action.command)}`, async () => {
    await withFakeHome(async (home) => {
      seedExistingProfiles(home, ["default", "work"]);
      const stdin = fakeStdin();
      const launchCalls: RunLaunchParams[] = [];

      const resultPromise = runInteractive({
        home,
        cswitchHome: cswitchHomePath(home),
        env: {},
        cwd: home,
        io: fakeIo(),
        stdin,
        write: () => {},
        launch: async (params) => {
          launchCalls.push(params);
          return 7;
        },
      });

      await settle();
      stdin.write("\x1b[B"); // down: default -> work
      await settle();
      stdin.write(action.key);
      const code = await resultPromise;

      assert.equal(code, 7);
      assert.equal(launchCalls.length, 1);
      assert.equal(launchCalls[0]!.profileName, "work");
      assert.deepEqual(launchCalls[0]!.command, action.command);
      assert.equal(launchCalls[0]!.quiet, false);

      // like Enter's select-run, these are not persistent
      const config = JSON.parse(readFileSync(path.join(cswitchHomePath(home), "config.json"), "utf8"));
      assert.deepEqual(config.bindings, []);
    });
  });
}

test("runInteractive: the launch keys work on the Default Profile too, unlike 'd'", async () => {
  await withFakeHome(async (home) => {
    seedExistingProfiles(home, ["default", "work"]);
    const stdin = fakeStdin();
    const launchCalls: RunLaunchParams[] = [];

    const resultPromise = runInteractive({
      home,
      cswitchHome: cswitchHomePath(home),
      env: {},
      cwd: home,
      io: fakeIo(),
      stdin,
      write: () => {},
      launch: async (params) => {
        launchCalls.push(params);
        return EXIT_OK;
      },
    });

    await settle();
    stdin.write("c"); // "default" is selected, and it is the in-place profile
    await resultPromise;

    assert.equal(launchCalls.length, 1);
    assert.equal(launchCalls[0]!.profileName, "default");
    assert.deepEqual(launchCalls[0]!.command, ["claude", "--continue"]);
  });
});

test("runInteractive: a launch key on an empty list is a no-op, like the other list keys", async () => {
  await withFakeHome(async (home) => {
    seedExistingProfiles(home, []);
    const stdin = fakeStdin();
    let launched = false;

    const resultPromise = runInteractive({
      home,
      cswitchHome: cswitchHomePath(home),
      env: {},
      cwd: home,
      io: fakeIo(),
      stdin,
      write: () => {},
      launch: async () => {
        launched = true;
        return EXIT_OK;
      },
    });

    await settle();
    stdin.write("c");
    await settle();
    stdin.write("r");
    await settle();
    stdin.write("m");
    await settle();
    stdin.write("\x1b"); // esc: still on the list, so this exits
    const code = await resultPromise;

    assert.equal(code, EXIT_OK);
    assert.equal(launched, false);
  });
});

test("runInteractive: launch keys restore the cursor before handing the terminal to claude", async () => {
  await withFakeHome(async (home) => {
    seedExistingProfiles(home, ["default"]);
    const stdin = fakeStdin();
    const written: string[] = [];

    const resultPromise = runInteractive({
      home,
      cswitchHome: cswitchHomePath(home),
      env: {},
      cwd: home,
      io: fakeIo(),
      stdin,
      write: (text) => written.push(text),
      launch: async () => {
        assert.ok(written.includes(SHOW_CURSOR), "the cursor must be back before the child process starts");
        return EXIT_OK;
      },
    });

    await settle();
    stdin.write("m");
    await resultPromise;

    assert.ok(written.includes(HIDE_CURSOR));
  });
});
