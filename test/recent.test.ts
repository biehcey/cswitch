import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { cswitchHomePath, type Config } from "../src/config.js";
import { listRecentDirectories } from "../src/recent.js";

function withFakeHome(fn: (home: string) => void): void {
  const home = mkdtempSync(path.join(os.tmpdir(), "cswitch-recent-test-"));
  try {
    fn(home);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

const CONFIG: Config = {
  version: 1,
  profiles: [{ name: "default", inPlace: true }, { name: "work" }],
  bindings: [],
};

/** Writes a profile's history.jsonl from (project, timestamp) pairs, plus any raw extra lines. */
function writeHistory(home: string, profile: "default" | "work", entries: Array<[string, number]>, rawLines: string[] = []): void {
  const dir = profile === "default" ? path.join(home, ".claude") : path.join(cswitchHomePath(home), "profiles", profile);
  mkdirSync(dir, { recursive: true });
  const lines = entries.map(([project, timestamp]) => JSON.stringify({ display: "hi", timestamp, project, sessionId: "s" }));
  writeFileSync(path.join(dir, "history.jsonl"), [...lines, ...rawLines].join("\n") + "\n");
}

function makeDir(home: string, name: string): string {
  const dir = path.join(home, "repos", name);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function list(home: string, extra: { config?: Config; platform?: NodeJS.Platform } = {}) {
  return listRecentDirectories({
    home,
    cswitchHome: cswitchHomePath(home),
    config: extra.config ?? CONFIG,
    platform: extra.platform,
  });
}

test("listRecentDirectories: merges every profile's history, newest first, one row per (directory, profile)", () => {
  withFakeHome((home) => {
    const alpha = makeDir(home, "alpha");
    const beta = makeDir(home, "beta");
    writeHistory(home, "default", [
      [alpha, 100],
      [alpha, 300],
    ]);
    writeHistory(home, "work", [[beta, 200]]);

    assert.deepEqual(list(home), [
      { dir: alpha, profile: "default", lastUsed: 300 },
      { dir: beta, profile: "work", lastUsed: 200 },
    ]);
  });
});

test("listRecentDirectories: a profile with no history.jsonl contributes nothing instead of failing", () => {
  withFakeHome((home) => {
    const alpha = makeDir(home, "alpha");
    writeHistory(home, "work", [[alpha, 100]]);

    assert.deepEqual(list(home), [{ dir: alpha, profile: "work", lastUsed: 100 }]);
  });
});

test("listRecentDirectories: unreadable lines are skipped silently — history.jsonl is Claude Code's format, not ours", () => {
  withFakeHome((home) => {
    const alpha = makeDir(home, "alpha");
    writeHistory(home, "default", [[alpha, 100]], [
      "{not json",
      JSON.stringify({ display: "no project field", timestamp: 500 }),
      JSON.stringify({ project: alpha, timestamp: "yesterday" }),
      "null",
    ]);

    assert.deepEqual(list(home), [{ dir: alpha, profile: "default", lastUsed: 100 }]);
  });
});

test("listRecentDirectories: a directory that no longer exists on disk is hidden", () => {
  withFakeHome((home) => {
    const alpha = makeDir(home, "alpha");
    const gone = path.join(home, "repos", "deleted-since");
    writeHistory(home, "default", [
      [alpha, 100],
      [gone, 200],
    ]);

    assert.deepEqual(list(home), [{ dir: alpha, profile: "default", lastUsed: 100 }]);
  });
});

test("listRecentDirectories: only the 10 newest rows are returned", () => {
  withFakeHome((home) => {
    const entries: Array<[string, number]> = [];
    for (let i = 1; i <= 12; i++) {
      entries.push([makeDir(home, `repo-${i}`), i]);
    }
    writeHistory(home, "default", entries);

    const rows = list(home);

    assert.equal(rows.length, 10);
    assert.equal(rows[0]!.lastUsed, 12);
    assert.equal(rows[9]!.lastUsed, 3);
  });
});

test("listRecentDirectories: on win32, paths differing only in letter case are one row, shown with the newest spelling", { skip: process.platform !== "win32" && "needs a case-insensitive filesystem" }, () => {
  withFakeHome((home) => {
    const alpha = makeDir(home, "alpha");
    writeHistory(home, "default", [
      [alpha.toLowerCase(), 100],
      [alpha.toUpperCase(), 300],
      [alpha, 200],
    ]);

    assert.deepEqual(list(home, { platform: "win32" }), [{ dir: alpha.toUpperCase(), profile: "default", lastUsed: 300 }]);
  });
});

test("listRecentDirectories: a relative project path is skipped — it would resolve against cswitch's own cwd, not where the user worked", () => {
  withFakeHome((home) => {
    const alpha = makeDir(home, "alpha");
    writeHistory(home, "default", [
      [alpha, 100],
      [".", 200],
    ]);

    assert.deepEqual(list(home), [{ dir: alpha, profile: "default", lastUsed: 100 }]);
  });
});
