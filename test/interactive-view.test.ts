import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { LAUNCH_ACTIONS } from "../src/interactive-actions.js";
import { ADD_FOOTER_HINT, CLEAR_SCREEN, LIST_FOOTER_HINT, REMOVE_FOOTER_HINT, renderAddScreen, renderProfileList, renderRemoveScreen } from "../src/interactive-view.js";
import type { RecentRow } from "../src/recent.js";
import type { ProfileStatus } from "../src/status.js";

// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-9;]*m/g;

function stripAnsi(text: string): string {
  return text.replace(ANSI, "");
}

function profile(overrides: Partial<ProfileStatus> = {}): ProfileStatus {
  return {
    name: "default",
    inPlace: true,
    account: { kind: "known", emailAddress: "a@b.com" },
    ...overrides,
  };
}

test("renderProfileList: lists every profile name and account", () => {
  const profiles = [profile({ name: "default", inPlace: true }), profile({ name: "work", inPlace: false, account: { kind: "not-logged-in" } })];
  const text = stripAnsi(renderProfileList(profiles, 0));

  assert.match(text, /default/);
  assert.match(text, /work/);
  assert.match(text, /a@b\.com/);
  assert.match(text, /\(not logged in\)/);
});

test("renderProfileList: shows Login State per profile", () => {
  const profiles = [
    profile({ name: "default", account: { kind: "known", emailAddress: "a@b.com" } }),
    profile({ name: "work", inPlace: false, account: { kind: "not-logged-in" } }),
    profile({ name: "ghost", inPlace: false, account: { kind: "unknown" } }),
  ];
  const text = stripAnsi(renderProfileList(profiles, 0));

  assert.match(text, /logged-in/);
  assert.match(text, /not-logged-in/);
  assert.match(text, /unknown/);
});

test("renderProfileList: marks only the in-place (Default) profile", () => {
  const profiles = [profile({ name: "default", inPlace: true }), profile({ name: "work", inPlace: false })];
  const lines = stripAnsi(renderProfileList(profiles, 0)).split("\n");

  const defaultLine = lines.find((l) => l.includes("default"))!;
  const workLine = lines.find((l) => l.includes("work"))!;
  assert.match(defaultLine, /\*/);
  assert.doesNotMatch(workLine, /\*/);
});

test("renderProfileList: the selected row is visually distinguished (colored)", () => {
  const profiles = [profile({ name: "default" }), profile({ name: "work", inPlace: false })];
  const raw = renderProfileList(profiles, 1);
  const lines = raw.split("\n");
  const workRawLine = lines.find((l) => l.includes("work"))!;
  const defaultRawLine = lines.find((l) => l.includes("default"))!;

  assert.match(workRawLine, /\x1b\[1m\x1b\[36m/);
  assert.doesNotMatch(defaultRawLine, /\x1b\[1m\x1b\[36m/);
});

test("renderProfileList: includes a fixed key-hint footer line", () => {
  const text = stripAnsi(renderProfileList([profile()], 0));
  assert.match(text, new RegExp(LIST_FOOTER_HINT.replace(/[[\]]/g, "\\$&")));
});

test("renderProfileList: does not throw on an empty profile list", () => {
  assert.doesNotThrow(() => renderProfileList([], 0));
});

test("renderProfileList: handles a very narrow layout without throwing (spec: 40-column terminal)", () => {
  const profiles = [profile({ name: "a-very-long-profile-name-indeed" }), profile({ name: "work", inPlace: false })];
  assert.doesNotThrow(() => renderProfileList(profiles, 0));
});

test("CLEAR_SCREEN is a distinct ANSI sequence from the table content", () => {
  assert.match(CLEAR_SCREEN, /\x1b\[/);
});

test("renderAddScreen: shows the name prompt with the draft typed so far", () => {
  const text = stripAnsi(renderAddScreen("wor", undefined));
  assert.match(text, /new profile/);
  assert.match(text, /name: wor/);
});

test("renderAddScreen: shows an error message when one is given", () => {
  const text = stripAnsi(renderAddScreen("Work", 'cswitch: "Work" is not a valid profile name'));
  assert.match(text, /is not a valid profile name/);
  // the draft is kept on screen so the user can correct it rather than retype it
  assert.match(text, /name: Work/);
});

test("renderAddScreen: omits the error line entirely when there is no error", () => {
  const text = stripAnsi(renderAddScreen("work", undefined));
  assert.doesNotMatch(text, /cswitch:/);
});

test("renderAddScreen: includes its own key-hint footer", () => {
  const text = stripAnsi(renderAddScreen("", undefined));
  assert.ok(text.includes(ADD_FOOTER_HINT));
});

test("LIST_FOOTER_HINT advertises the add key, since 'a' opens the add screen", () => {
  assert.match(LIST_FOOTER_HINT, /\[a\]dd/);
});

test("LIST_FOOTER_HINT advertises the remove key, since 'd' opens the remove screen", () => {
  assert.match(LIST_FOOTER_HINT, /\[d\] remove/);
});

test("renderProfileList: shows a notice line under the table when one is given", () => {
  const text = stripAnsi(renderProfileList([profile()], 0, 'cswitch: removed "work" from config, but could not delete its directory'));
  assert.match(text, /could not delete its directory/);
  // the table itself is still there
  assert.match(text, /PROFILE/);
});

test("renderProfileList: omits the notice line entirely when there is none", () => {
  const text = stripAnsi(renderProfileList([profile()], 0));
  assert.doesNotMatch(text, /cswitch:/);
});

test("renderRemoveScreen: asks the exact confirmation the flag-based remove asks", () => {
  const text = stripAnsi(renderRemoveScreen("work", undefined));
  assert.match(text, /delete work\? this cannot be undone \(y\/n\)/);
});

test("renderRemoveScreen: does not ask the name to be retyped", () => {
  const text = stripAnsi(renderRemoveScreen("work", undefined));
  assert.doesNotMatch(text, /type/i);
  // the name appears once, in the question itself
  assert.equal(text.match(/work/g)!.length, 1);
});

test("renderRemoveScreen: shows an error message when one is given", () => {
  const text = stripAnsi(renderRemoveScreen("work", 'cswitch: no profile named "work" in ~/.cswitch/config.json'));
  assert.match(text, /no profile named/);
});

test("renderRemoveScreen: includes its own key-hint footer", () => {
  const text = stripAnsi(renderRemoveScreen("work", undefined));
  assert.ok(text.includes(REMOVE_FOOTER_HINT));
});

test("LIST_FOOTER_HINT is generated from LAUNCH_ACTIONS, not hand-written", () => {
  for (const action of LAUNCH_ACTIONS) {
    assert.ok(LIST_FOOTER_HINT.includes(`[${action.key}]${action.label.slice(1)}`), `footer is missing a hint for [${action.key}]`);
  }
});

test("LIST_FOOTER_HINT advertises run, the launch actions, add, remove and quit, in that order", () => {
  assert.equal(LIST_FOOTER_HINT, "[enter] run   [c]ontinue   [r]esume   [m]cp   [a]dd   [d] remove   [esc] quit");
});

test("LAUNCH_ACTIONS: each key launches a claude invocation, and no key collides with the list's own keys", () => {
  assert.deepEqual(
    LAUNCH_ACTIONS.map((a) => a.command),
    [
      ["claude", "--continue"],
      ["claude", "--resume"],
      ["claude", "mcp", "list"],
    ],
  );
  for (const action of LAUNCH_ACTIONS) {
    assert.equal(action.key.length, 1);
    assert.ok(!["a", "d", "y", "n"].includes(action.key), `[${action.key}] collides with an existing list key`);
    assert.ok(action.label.startsWith(action.key), "a label must start with its own key, so the footer can bracket it");
  }
});

const HOME = process.platform === "win32" ? "C:\\Users\\me" : "/home/me";
const NOW = Date.UTC(2026, 10, 2, 12, 0, 0);
const HOUR = 60 * 60 * 1000;

function recentRow(overrides: Partial<RecentRow> = {}): RecentRow {
  return { dir: path.join(HOME, "repos", "alpha"), profile: "work", lastUsed: NOW - 2 * HOUR, bindingConflict: false, ...overrides };
}

function lineContaining(text: string, needle: string): string {
  const line = text.split("\n").find((candidate) => candidate.includes(needle));
  assert.ok(line !== undefined, `no line contains ${needle}`);
  return line;
}

test("renderProfileList: Recent Directories appear under a RECENT heading with a ~-shortened path, the profile and how long ago", () => {
  const text = stripAnsi(renderProfileList([profile()], 0, undefined, { rows: [recentRow()], home: HOME, now: NOW }));

  assert.match(text, /RECENT/);
  const row = lineContaining(text, "alpha");
  assert.ok(row.includes(path.join("~", "repos", "alpha")), row);
  assert.match(row, /work/);
  assert.match(row, /2h ago/);
  assert.ok(text.indexOf("RECENT") > text.indexOf("PROFILE"));
});

test("renderProfileList: relative times read as just now / minutes / hours / days", () => {
  const rows = [
    recentRow({ dir: path.join(HOME, "a1"), lastUsed: NOW - 10 * 1000 }),
    recentRow({ dir: path.join(HOME, "a2"), lastUsed: NOW - 5 * 60 * 1000 }),
    recentRow({ dir: path.join(HOME, "a3"), lastUsed: NOW - 3 * HOUR }),
    recentRow({ dir: path.join(HOME, "a4"), lastUsed: NOW - 4 * 24 * HOUR }),
  ];
  const text = stripAnsi(renderProfileList([profile()], 0, undefined, { rows, home: HOME, now: NOW }));

  assert.match(lineContaining(text, "a1"), /just now/);
  assert.match(lineContaining(text, "a2"), /5m ago/);
  assert.match(lineContaining(text, "a3"), /3h ago/);
  assert.match(lineContaining(text, "a4"), /4d ago/);
});

test("renderProfileList: only a row whose directory is bound to another profile carries the ≠binding mark", () => {
  const rows = [recentRow({ dir: path.join(HOME, "bound-elsewhere"), bindingConflict: true }), recentRow({ dir: path.join(HOME, "fine") })];
  const text = stripAnsi(renderProfileList([profile()], 0, undefined, { rows, home: HOME, now: NOW }));

  assert.match(lineContaining(text, "bound-elsewhere"), /≠binding/);
  assert.doesNotMatch(lineContaining(text, "fine"), /≠binding/);
});

test("renderProfileList: a selectedIndex past the profiles selects a Recent Directory row — one list, two sections", () => {
  const profiles = [profile({ name: "default" }), profile({ name: "work", inPlace: false })];
  const rows = [recentRow({ dir: path.join(HOME, "first") }), recentRow({ dir: path.join(HOME, "second") })];
  const text = stripAnsi(renderProfileList(profiles, 3, undefined, { rows, home: HOME, now: NOW }));

  assert.match(lineContaining(text, "second"), /^> /);
  assert.doesNotMatch(lineContaining(text, "first"), /^> /);
  assert.doesNotMatch(lineContaining(text, "default"), /^> /);
});

test("renderProfileList: with no Recent Directories there is no RECENT heading at all", () => {
  const text = stripAnsi(renderProfileList([profile()], 0, undefined, { rows: [], home: HOME, now: NOW }));

  assert.doesNotMatch(text, /RECENT/);
});

test("renderProfileList: with a Recent Directory row selected, the footer does not advertise [d] remove — 'd' does nothing there", () => {
  const recent = { rows: [recentRow()], home: HOME, now: NOW };

  const onRecent = stripAnsi(renderProfileList([profile({ name: "work", inPlace: false })], 1, undefined, recent));
  const onProfile = stripAnsi(renderProfileList([profile({ name: "work", inPlace: false })], 0, undefined, recent));

  assert.doesNotMatch(onRecent, /\[d\] remove/);
  assert.match(onRecent, /\[enter\] run/);
  assert.match(onRecent, /\[c\]ontinue/);
  assert.match(onProfile, /\[d\] remove/);
});
