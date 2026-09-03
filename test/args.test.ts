import assert from "node:assert/strict";
import test from "node:test";
import { parseTopLevel } from "../src/args.js";

test("no arguments prints help and is a usage error (exit 64)", () => {
  const result = parseTopLevel([]);
  assert.deepEqual(result, { kind: "help", exitCode: 64 });
});

test("-h alone shows help and exits 0", () => {
  assert.deepEqual(parseTopLevel(["-h"]), { kind: "help", exitCode: 0 });
});

test("--help alone shows help and exits 0", () => {
  assert.deepEqual(parseTopLevel(["--help"]), { kind: "help", exitCode: 0 });
});

test("-V alone shows the version", () => {
  assert.deepEqual(parseTopLevel(["-V"]), { kind: "version" });
});

test("--version alone shows the version", () => {
  assert.deepEqual(parseTopLevel(["--version"]), { kind: "version" });
});

test("a profile name without `--` is rejected with usage error", () => {
  const result = parseTopLevel(["work"]);
  assert.equal(result.kind, "usage-error");
  if (result.kind === "usage-error") {
    assert.match(result.message, /--/);
    assert.match(result.message, /cswitch \[<profile>\] -- <command>/);
  }
});

test("`work --help` (no `--` separator) is a usage error, not help", () => {
  const result = parseTopLevel(["work", "--help"]);
  assert.equal(result.kind, "usage-error");
});

test("tokens after `--` are never parsed, including flags meant for the child", () => {
  const result = parseTopLevel(["work", "--", "claude", "-q"]);
  assert.deepEqual(result, {
    kind: "launch",
    profile: "work",
    quiet: false,
    command: ["claude", "-q"],
  });
});

test("no profile before `--` resolves via binding later; parser leaves it undefined", () => {
  const result = parseTopLevel(["--", "claude"]);
  assert.deepEqual(result, {
    kind: "launch",
    profile: undefined,
    quiet: false,
    command: ["claude"],
  });
});

test("-q before `--` is consumed by cswitch, not passed through", () => {
  const result = parseTopLevel(["work", "-q", "--", "claude"]);
  assert.deepEqual(result, {
    kind: "launch",
    profile: "work",
    quiet: true,
    command: ["claude"],
  });
});

test("a bare `--` with nothing after it is a usage error", () => {
  const result = parseTopLevel(["work", "--"]);
  assert.equal(result.kind, "usage-error");
});

test("more than one profile-like token before `--` is a usage error", () => {
  const result = parseTopLevel(["work", "personal", "--", "claude"]);
  assert.equal(result.kind, "usage-error");
});

test("-h combined with `--` and a command is a usage error", () => {
  const result = parseTopLevel(["-h", "--", "claude"]);
  assert.equal(result.kind, "usage-error");
});

test("known subcommands are recognised without requiring `--`", () => {
  assert.deepEqual(parseTopLevel(["status"]), { kind: "subcommand", name: "status", rest: [] });
  assert.deepEqual(parseTopLevel(["bind", "--list"]), {
    kind: "subcommand",
    name: "bind",
    rest: ["--list"],
  });
});
