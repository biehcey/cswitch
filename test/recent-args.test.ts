import assert from "node:assert/strict";
import test from "node:test";
import { parseRecentArgs } from "../src/recent-args.js";

test("parseRecentArgs: no arguments is ok", () => {
  assert.deepEqual(parseRecentArgs([]), { kind: "ok" });
});

test("parseRecentArgs: any argument is rejected, naming it", () => {
  assert.deepEqual(parseRecentArgs(["--json"]), { kind: "error", message: "cswitch recent: unknown argument `--json`" });
});
