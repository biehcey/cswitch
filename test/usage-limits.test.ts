import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  credentialsServiceName,
  fetchUsageLimits,
  loadUsageLimits,
  formatUsageLimits,
  parseUsageLimits,
  readAccessToken,
  usageLimitsDisabled,
} from "../src/usage-limits.js";

const NOW = Date.parse("2026-11-02T14:00:00Z");

function withTmpDir(fn: (dir: string) => void): void {
  const dir = mkdtempSync(path.join(os.tmpdir(), "cswitch-usage-test-"));
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function credentialsJson(accessToken: string, expiresAt: number): string {
  return JSON.stringify({ claudeAiOauth: { accessToken, refreshToken: "r", expiresAt } });
}

// --- readAccessToken -------------------------------------------------------

test("readAccessToken: reads a live token from <configDir>/.credentials.json off macOS", () => {
  withTmpDir((dir) => {
    writeFileSync(path.join(dir, ".credentials.json"), credentialsJson("tok-live", NOW + 60_000));
    assert.equal(readAccessToken({ configDir: dir, inPlace: false, platform: "linux", now: NOW }), "tok-live");
  });
});

test("readAccessToken: an expired token is not used (cswitch never refreshes one)", () => {
  withTmpDir((dir) => {
    writeFileSync(path.join(dir, ".credentials.json"), credentialsJson("tok-old", NOW - 1));
    assert.equal(readAccessToken({ configDir: dir, inPlace: false, platform: "win32", now: NOW }), undefined);
  });
});

test("readAccessToken: missing or corrupt credentials read as no token, never a throw", () => {
  withTmpDir((dir) => {
    assert.equal(readAccessToken({ configDir: dir, inPlace: false, platform: "linux", now: NOW }), undefined);
    writeFileSync(path.join(dir, ".credentials.json"), "{not json");
    assert.equal(readAccessToken({ configDir: dir, inPlace: false, platform: "linux", now: NOW }), undefined);
    writeFileSync(path.join(dir, ".credentials.json"), JSON.stringify({ claudeAiOauth: { accessToken: 42 } }));
    assert.equal(readAccessToken({ configDir: dir, inPlace: false, platform: "linux", now: NOW }), undefined);
  });
});

test("readAccessToken: on macOS reads the Keychain entry for the profile's config dir", () => {
  const calls: string[][] = [];
  const token = readAccessToken({
    configDir: "/Users/me/.cswitch/profiles/work",
    inPlace: false,
    platform: "darwin",
    now: NOW,
    readKeychain: (args) => {
      calls.push(args);
      return credentialsJson("tok-mac", NOW + 60_000);
    },
  });
  assert.equal(token, "tok-mac");
  assert.deepEqual(calls[0]!.slice(0, 3), ["find-generic-password", "-s", credentialsServiceName("/Users/me/.cswitch/profiles/work", false)]);
  assert.ok(calls[0]!.includes("-w"));
});

test("readAccessToken: on macOS a missing Keychain entry reads as no token", () => {
  const token = readAccessToken({ configDir: "/x", inPlace: true, platform: "darwin", now: NOW, readKeychain: () => undefined });
  assert.equal(token, undefined);
});

test("credentialsServiceName: the in-place (~/.claude) profile uses Claude Code's unsuffixed name", () => {
  assert.equal(credentialsServiceName("/Users/me/.claude", true), "Claude Code-credentials");
  assert.match(credentialsServiceName("/Users/me/.cswitch/profiles/work", false), /^Claude Code-credentials-[0-9a-f]{8}$/);
});

// --- parseUsageLimits ------------------------------------------------------

test("parseUsageLimits: picks the 5-hour and weekly utilization", () => {
  const limits = parseUsageLimits({
    five_hour: { utilization: 37.0, resets_at: "2026-11-02T16:10:00+00:00" },
    seven_day: { utilization: 7.4, resets_at: "2026-11-06T23:00:00+00:00" },
    seven_day_opus: null,
  });
  assert.deepEqual(limits, { fiveHourPercent: 37, weeklyPercent: 7 });
});

test("parseUsageLimits: a window the account doesn't have is left out, not shown as 0%", () => {
  assert.deepEqual(parseUsageLimits({ five_hour: { utilization: 12 }, seven_day: null }), { fiveHourPercent: 12 });
});

test("parseUsageLimits: an unrecognized shape reads as nothing to show", () => {
  assert.equal(parseUsageLimits(null), undefined);
  assert.equal(parseUsageLimits({ error: "nope" }), undefined);
  assert.equal(parseUsageLimits({ five_hour: { utilization: "lots" } }), undefined);
});

// --- fetchUsageLimits ------------------------------------------------------

test("fetchUsageLimits: sends the token as a bearer and parses a 200", async () => {
  let seenAuth: string | null = null;
  const limits = await fetchUsageLimits("tok", async (_url, init) => {
    seenAuth = new Headers(init?.headers).get("authorization");
    return new Response(JSON.stringify({ five_hour: { utilization: 91 }, seven_day: { utilization: 63 } }), { status: 200 });
  });
  assert.equal(seenAuth, "Bearer tok");
  assert.deepEqual(limits, { fiveHourPercent: 91, weeklyPercent: 63 });
});

test("fetchUsageLimits: a non-200, a network error or bad JSON all read as undefined", async () => {
  assert.equal(await fetchUsageLimits("tok", async () => new Response("no", { status: 401 })), undefined);
  assert.equal(await fetchUsageLimits("tok", async () => new Response("{oops", { status: 200 })), undefined);
  assert.equal(
    await fetchUsageLimits("tok", async () => {
      throw new Error("offline");
    }),
    undefined,
  );
});

// --- formatUsageLimits / opt-out -------------------------------------------

test("formatUsageLimits: short form for the list row", () => {
  assert.equal(formatUsageLimits({ fiveHourPercent: 37, weeklyPercent: 7 }), "5h 37% · week 7%");
  assert.equal(formatUsageLimits({ weeklyPercent: 50 }), "week 50%");
});

test("usageLimitsDisabled: CSWITCH_NO_USAGE turns the network call off", () => {
  assert.equal(usageLimitsDisabled({}), false);
  assert.equal(usageLimitsDisabled({ CSWITCH_NO_USAGE: "1" }), true);
  assert.equal(usageLimitsDisabled({ CSWITCH_NO_USAGE: "" }), false);
});

test("loadUsageLimits: no token means no request at all", async () => {
  const home = mkdtempSync(path.join(os.tmpdir(), "cswitch-usage-test-"));
  try {
    let requests = 0;
    const limits = await loadUsageLimits({
      home,
      cswitchHome: path.join(home, ".cswitch"),
      record: { name: "work" },
      env: {},
      platform: "linux",
      fetchImpl: async () => {
        requests++;
        return new Response("{}");
      },
    });
    assert.equal(limits, undefined);
    assert.equal(requests, 0);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("loadUsageLimits: CSWITCH_NO_USAGE skips even a profile with a live token", async () => {
  const home = mkdtempSync(path.join(os.tmpdir(), "cswitch-usage-test-"));
  try {
    const dir = path.join(home, ".cswitch", "profiles", "work");
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, ".credentials.json"), credentialsJson("tok", Date.now() + 60_000));
    let requests = 0;
    const fetchImpl = async () => {
      requests++;
      return new Response(JSON.stringify({ five_hour: { utilization: 5 } }));
    };
    const base = { home, cswitchHome: path.join(home, ".cswitch"), record: { name: "work" }, platform: "linux" as const, fetchImpl };

    assert.equal(await loadUsageLimits({ ...base, env: { CSWITCH_NO_USAGE: "1" } }), undefined);
    assert.equal(requests, 0);
    assert.deepEqual(await loadUsageLimits({ ...base, env: {} }), { fiveHourPercent: 5 });
    assert.equal(requests, 1);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
