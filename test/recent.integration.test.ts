import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

const here = path.dirname(fileURLToPath(import.meta.url));
const cliEntry = path.join(here, "..", "src", "cli.ts");
const tsxLoader = pathToFileURL(path.join(here, "..", "node_modules", "tsx", "dist", "loader.mjs")).href;

function withFakeHome(fn: (home: string) => void): void {
  const home = mkdtempSync(path.join(os.tmpdir(), "cswitch-recent-integration-test-"));
  try {
    fn(home);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

function runCli(home: string, args: string[]) {
  return spawnSync(process.execPath, ["--import", tsxLoader, cliEntry, ...args], {
    encoding: "utf8",
    env: { ...process.env, CSWITCH_HOME: home },
  });
}

function init(home: string): void {
  const result = runCli(home, ["init"]);
  assert.equal(result.status, 0, result.stderr);
}

test("cswitch recent prints one plain row per Recent Directory: full path, profile, how long ago — newest first", () => {
  withFakeHome((home) => {
    init(home);
    const older = path.join(home, "repos", "older");
    const newer = path.join(home, "repos", "newer");
    mkdirSync(older, { recursive: true });
    mkdirSync(newer, { recursive: true });
    mkdirSync(path.join(home, ".claude"), { recursive: true });
    const now = Date.now();
    writeFileSync(
      path.join(home, ".claude", "history.jsonl"),
      [
        JSON.stringify({ project: older, timestamp: now - 3 * 60 * 60 * 1000 }),
        JSON.stringify({ project: newer, timestamp: now - 5 * 60 * 1000 }),
      ].join("\n") + "\n",
    );

    const result = runCli(home, ["recent"]);

    assert.equal(result.status, 0, result.stderr);
    assert.doesNotMatch(result.stdout, /\x1b\[/, "plain output, no ANSI color");
    const lines = result.stdout.trimEnd().split("\n");
    const newerLine = lines.findIndex((line) => line.includes(newer));
    const olderLine = lines.findIndex((line) => line.includes(older));
    assert.ok(newerLine >= 0 && olderLine > newerLine, result.stdout);
    assert.match(lines[newerLine]!, /default\s+5m ago/);
    assert.match(lines[olderLine]!, /default\s+3h ago/);
  });
});

test("cswitch recent with no history prints nothing and exits 0", () => {
  withFakeHome((home) => {
    init(home);

    const result = runCli(home, ["recent"]);

    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, "");
  });
});

test("cswitch recent takes no arguments", () => {
  withFakeHome((home) => {
    init(home);

    const result = runCli(home, ["recent", "--json"]);

    assert.equal(result.status, 64);
    assert.match(result.stderr, /cswitch recent: unknown argument `--json`/);
  });
});

test("cswitch recent before init exits 70", () => {
  withFakeHome((home) => {
    const result = runCli(home, ["recent"]);

    assert.equal(result.status, 70);
  });
});
