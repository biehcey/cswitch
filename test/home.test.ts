import assert from "node:assert/strict";
import os from "node:os";
import test from "node:test";
import { resolveHome } from "../src/home.js";

test("resolveHome falls back to os.homedir() when CSWITCH_HOME is unset", () => {
  assert.equal(resolveHome({}), os.homedir());
});

test("resolveHome is redirectable to a fake directory via CSWITCH_HOME", () => {
  const fakeHome = "C:\\fake\\cswitch-home";
  assert.equal(resolveHome({ CSWITCH_HOME: fakeHome }), fakeHome);
});

test("resolveHome ignores an empty CSWITCH_HOME", () => {
  assert.equal(resolveHome({ CSWITCH_HOME: "" }), os.homedir());
});
