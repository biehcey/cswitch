import assert from "node:assert/strict";
import test from "node:test";
import { parseCopyArgs } from "../src/copy-args.js";

test("parseCopyArgs: two positionals with no flags copy both categories", () => {
  assert.deepEqual(parseCopyArgs(["work", "personal"]), {
    kind: "ok",
    source: "work",
    target: "personal",
    plugins: true,
    mcp: true,
    dryRun: false,
  });
});

test("parseCopyArgs: --plugins narrows to the plugin keys", () => {
  assert.deepEqual(parseCopyArgs(["work", "personal", "--plugins"]), {
    kind: "ok",
    source: "work",
    target: "personal",
    plugins: true,
    mcp: false,
    dryRun: false,
  });
});

test("parseCopyArgs: --mcp narrows to the MCP servers", () => {
  const result = parseCopyArgs(["--mcp", "work", "personal"]);
  assert.deepEqual(result, {
    kind: "ok",
    source: "work",
    target: "personal",
    plugins: false,
    mcp: true,
    dryRun: false,
  });
});

test("parseCopyArgs: both flags together are the same as neither", () => {
  const result = parseCopyArgs(["work", "personal", "--plugins", "--mcp"]);
  assert.equal(result.kind, "ok");
  assert.deepEqual(result, { kind: "ok", source: "work", target: "personal", plugins: true, mcp: true, dryRun: false });
});

test("parseCopyArgs: --dry-run is recorded", () => {
  const result = parseCopyArgs(["work", "personal", "--dry-run"]);
  assert.equal(result.kind, "ok");
  assert.equal((result as { dryRun: boolean }).dryRun, true);
});

test("parseCopyArgs: no arguments is an error", () => {
  const result = parseCopyArgs([]);
  assert.equal(result.kind, "error");
  assert.match((result as { message: string }).message, /a source and a target profile are required/);
});

test("parseCopyArgs: a single profile name is an error", () => {
  const result = parseCopyArgs(["work"]);
  assert.equal(result.kind, "error");
  assert.match((result as { message: string }).message, /a source and a target profile are required/);
});

test("parseCopyArgs: a third positional is rejected", () => {
  const result = parseCopyArgs(["work", "personal", "extra"]);
  assert.equal(result.kind, "error");
  assert.match((result as { message: string }).message, /unexpected argument `extra`/);
});

test("parseCopyArgs: an unknown flag is rejected", () => {
  const result = parseCopyArgs(["work", "personal", "--nope"]);
  assert.equal(result.kind, "error");
  assert.match((result as { message: string }).message, /unknown argument `--nope`/);
});

test("parseCopyArgs: the same profile twice is a usage error", () => {
  const result = parseCopyArgs(["work", "work"]);
  assert.equal(result.kind, "error");
  assert.match((result as { message: string }).message, /the source and target profile are the same/);
});
