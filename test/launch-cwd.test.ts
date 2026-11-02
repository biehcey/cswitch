import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { runLaunch } from "../src/launch.js";

test("runLaunch: the child starts in the cwd it was given, not in cswitch's own directory", async () => {
  const home = mkdtempSync(path.join(os.tmpdir(), "cswitch-launch-cwd-test-"));
  try {
    const target = path.join(home, "repos", "alpha");
    mkdirSync(target, { recursive: true });
    const out = path.join(home, "child-cwd.txt");
    assert.notEqual(realpathSync(process.cwd()), realpathSync(target));

    const code = await runLaunch({
      home,
      cswitchHome: path.join(home, ".cswitch"),
      config: { version: 1, profiles: [{ name: "default", inPlace: true }], bindings: [] },
      profileName: "default",
      quiet: true,
      command: [process.execPath, "-e", `require("fs").writeFileSync(${JSON.stringify(out)}, process.cwd())`],
      env: process.env,
      cwd: target,
    });

    assert.equal(code, 0);
    assert.equal(realpathSync(readFileSync(out, "utf8")), realpathSync(target));
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
