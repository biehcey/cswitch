import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { HELP_TEXT } from "../src/help-text.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const cliEntry = path.join(here, "..", "src", "cli.ts");

function runCli(args: string[], env: NodeJS.ProcessEnv = {}) {
  const fakeHome = mkdtempSync(path.join(os.tmpdir(), "cswitch-test-"));
  try {
    return spawnSync(process.execPath, ["--import", "tsx", cliEntry, ...args], {
      encoding: "utf8",
      env: { ...process.env, CSWITCH_HOME: fakeHome, ...env },
    });
  } finally {
    rmSync(fakeHome, { recursive: true, force: true });
  }
}

test("cswitch --help prints the spec's help text and exits 0", () => {
  const result = runCli(["--help"]);
  assert.equal(result.status, 0);
  assert.equal(result.stdout.trim(), HELP_TEXT.trim());
});

test("cswitch -V prints the version and exits 0", () => {
  const result = runCli(["-V"]);
  assert.equal(result.status, 0);
  assert.match(result.stdout.trim(), /^\d+\.\d+\.\d+/);
});

test("cswitch with no arguments prints help and exits 64", () => {
  const result = runCli([]);
  assert.equal(result.status, 64);
  assert.match(result.stderr, /run multiple Claude Code accounts/);
});

test("cswitch work (no --) is rejected with exit 64 and states the correct form", () => {
  const result = runCli(["work"]);
  assert.equal(result.status, 64);
  assert.match(result.stderr, /cswitch \[<profile>\] -- <command>/);
});

test("cswitch work --help is an error; the correct form is cswitch --help", () => {
  const result = runCli(["work", "--help"]);
  assert.equal(result.status, 64);
  assert.match(result.stderr, /cswitch \[<profile>\] -- <command>/);
});

test("tokens after -- are passed through untouched, e.g. -q reaches the child, not cswitch", () => {
  const result = runCli(["work", "--", "node", "-e", "console.log(process.argv.slice(2).join(','))", "-q"]);
  // cswitch itself has no launcher yet (ticket 03); this only asserts that
  // parsing did not error out on `-q` appearing after `--`.
  assert.notEqual(result.status, 64);
});
