import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

const here = path.dirname(fileURLToPath(import.meta.url));
const cliEntry = path.join(here, "..", "src", "cli.ts");
const tsxLoader = pathToFileURL(path.join(here, "..", "node_modules", "tsx", "dist", "loader.mjs")).href;

function withFakeHome(fn: (home: string) => void): void {
  const home = mkdtempSync(path.join(os.tmpdir(), "cswitch-copy-test-"));
  try {
    fn(home);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

function runCli(home: string, args: string[], env: NodeJS.ProcessEnv = {}) {
  return spawnSync(process.execPath, ["--import", tsxLoader, cliEntry, ...args], {
    encoding: "utf8",
    env: { ...process.env, CSWITCH_HOME: home, ...env },
  });
}

/** `init` adopts ~/.claude as the in-place profile; `add` makes the ordinary ones. */
function setUp(home: string, ...profiles: string[]): void {
  const init = runCli(home, ["init", "--name", "main"]);
  assert.equal(init.status, 0, init.stderr);
  for (const profile of profiles) {
    const added = runCli(home, ["add", profile]);
    assert.equal(added.status, 0, added.stderr);
  }
}

function profileFile(home: string, profile: string | "in-place", file: "settings.json" | ".claude.json"): string {
  if (profile === "in-place") {
    return file === "settings.json" ? path.join(home, ".claude", "settings.json") : path.join(home, ".claude.json");
  }
  return path.join(home, ".cswitch", "profiles", profile, file);
}

function writeJson(target: string, contents: object): void {
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, `${JSON.stringify(contents, null, 2)}\n`, "utf8");
}

function readJson(target: string): Record<string, unknown> {
  return JSON.parse(readFileSync(target, "utf8"));
}

test("cswitch copy merges both categories into the target and reports each key", () => {
  withFakeHome((home) => {
    setUp(home, "work", "personal");
    writeJson(profileFile(home, "work", "settings.json"), {
      enabledPlugins: { "a@market": true, "b@market": false, "same@market": true },
      extraKnownMarketplaces: { market: { source: { source: "github", repo: "x/y" } } },
      model: "opus",
    });
    writeJson(profileFile(home, "work", ".claude.json"), {
      mcpServers: { linear: { type: "http", url: "https://linear" } },
    });
    writeJson(profileFile(home, "personal", "settings.json"), {
      enabledPlugins: { "b@market": true, "same@market": true, "kept@market": true },
      theme: "dark",
    });

    const result = runCli(home, ["copy", "work", "personal"]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /\+ a@market added/);
    assert.match(result.stdout, /~ b@market overwritten \(true → false\)/);
    assert.match(result.stdout, /= same@market unchanged/);
    assert.match(result.stdout, /\+ linear added/);
    assert.match(result.stdout, /re-authenticated in "personal"/);

    const settings = readJson(profileFile(home, "personal", "settings.json"));
    assert.deepEqual(settings.enabledPlugins, {
      "b@market": false,
      "same@market": true,
      "kept@market": true,
      "a@market": true,
    });
    assert.deepEqual(settings.extraKnownMarketplaces, { market: { source: { source: "github", repo: "x/y" } } });
    assert.equal(settings.theme, "dark");
    // Out of scope: the rest of the source's settings.json (§K1).
    assert.equal(settings.model, undefined);

    const claudeJson = readJson(profileFile(home, "personal", ".claude.json"));
    assert.deepEqual(claudeJson.mcpServers, { linear: { type: "http", url: "https://linear" } });
  });
});

test("cswitch copy --dry-run prints the same plan but writes nothing", () => {
  withFakeHome((home) => {
    setUp(home, "work", "personal");
    writeJson(profileFile(home, "work", "settings.json"), { enabledPlugins: { "a@market": true } });
    writeJson(profileFile(home, "work", ".claude.json"), { mcpServers: { linear: { url: "https://linear" } } });

    const result = runCli(home, ["copy", "work", "personal", "--dry-run"]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /\+ a@market added/);
    assert.match(result.stdout, /nothing written \(--dry-run\)/);
    // The credentials warning is part of the plan, so the preview must carry it too (K6).
    assert.match(result.stdout, /re-authenticated in "personal"/);

    assert.ok(!existsSync(profileFile(home, "personal", "settings.json")));
    assert.ok(!existsSync(profileFile(home, "personal", ".claude.json")));
  });
});

test("cswitch copy --plugins copies only the settings keys", () => {
  withFakeHome((home) => {
    setUp(home, "work", "personal");
    writeJson(profileFile(home, "work", "settings.json"), { enabledPlugins: { "a@market": true } });
    writeJson(profileFile(home, "work", ".claude.json"), { mcpServers: { linear: { url: "https://linear" } } });

    const result = runCli(home, ["copy", "work", "personal", "--plugins"]);
    assert.equal(result.status, 0, result.stderr);
    assert.doesNotMatch(result.stdout, /linear/);
    assert.doesNotMatch(result.stdout, /re-authenticated/);

    assert.ok(existsSync(profileFile(home, "personal", "settings.json")));
    assert.ok(!existsSync(profileFile(home, "personal", ".claude.json")));
  });
});

test("cswitch copy into the in-place profile backs the target files up first", () => {
  withFakeHome((home) => {
    setUp(home, "work");
    writeJson(profileFile(home, "work", "settings.json"), { enabledPlugins: { "a@market": true } });
    writeJson(profileFile(home, "in-place", "settings.json"), { enabledPlugins: { "old@market": true } });

    const result = runCli(home, ["copy", "work", "main"]);
    assert.equal(result.status, 0, result.stderr);

    const backups = readdirSync(path.join(home, ".claude")).filter((name) => name.startsWith("settings.json.bak-"));
    assert.equal(backups.length, 1, `expected one backup, saw ${backups.join(", ")}`);
    assert.deepEqual(readJson(path.join(home, ".claude", backups[0]!)), { enabledPlugins: { "old@market": true } });
    assert.deepEqual(readJson(profileFile(home, "in-place", "settings.json")).enabledPlugins, {
      "old@market": true,
      "a@market": true,
    });
  });
});

test("cswitch copy out of the in-place profile reads ~/.claude/settings.json", () => {
  withFakeHome((home) => {
    setUp(home, "work");
    writeJson(profileFile(home, "in-place", "settings.json"), { enabledPlugins: { "a@market": true } });

    const result = runCli(home, ["copy", "main", "work"]);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(readJson(profileFile(home, "work", "settings.json")).enabledPlugins, { "a@market": true });
  });
});

test("cswitch copy never touches .credentials.json (§K6)", () => {
  withFakeHome((home) => {
    setUp(home, "work", "personal");
    writeJson(profileFile(home, "work", ".claude.json"), { mcpServers: { linear: { url: "https://linear" } } });
    const sourceCredentials = path.join(home, ".cswitch", "profiles", "work", ".credentials.json");
    const targetCredentials = path.join(home, ".cswitch", "profiles", "personal", ".credentials.json");
    writeJson(sourceCredentials, { claudeAiOauth: { accessToken: "source-token" } });
    writeJson(targetCredentials, { claudeAiOauth: { accessToken: "target-token" } });

    const result = runCli(home, ["copy", "work", "personal"]);
    assert.equal(result.status, 0, result.stderr);

    assert.deepEqual(readJson(targetCredentials), { claudeAiOauth: { accessToken: "target-token" } });
    assert.deepEqual(readJson(sourceCredentials), { claudeAiOauth: { accessToken: "source-token" } });
  });
});

test("cswitch copy with nothing to copy exits 0 with an explanation", () => {
  withFakeHome((home) => {
    setUp(home, "work", "personal");

    const result = runCli(home, ["copy", "work", "personal"]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Nothing to copy from "work" to "personal"/);
  });
});

test("cswitch copy rejects an unknown profile with exit 64", () => {
  withFakeHome((home) => {
    setUp(home, "work");
    const result = runCli(home, ["copy", "work", "ghost"]);
    assert.equal(result.status, 64);
    assert.match(result.stderr, /no profile named "ghost"/);
  });
});

test("cswitch copy rejects the same profile twice with exit 64", () => {
  withFakeHome((home) => {
    setUp(home, "work");
    const result = runCli(home, ["copy", "work", "work"]);
    assert.equal(result.status, 64);
    assert.match(result.stderr, /the source and target profile are the same/);
  });
});

test("cswitch copy exits 70 on malformed JSON without writing anything", () => {
  withFakeHome((home) => {
    setUp(home, "work", "personal");
    writeJson(profileFile(home, "work", "settings.json"), { enabledPlugins: { "a@market": true } });
    writeFileSync(profileFile(home, "personal", "settings.json"), "{ oops", "utf8");

    const result = runCli(home, ["copy", "work", "personal"]);
    assert.equal(result.status, 70);
    assert.match(result.stderr, /is not valid JSON/);
    assert.equal(readFileSync(profileFile(home, "personal", "settings.json"), "utf8"), "{ oops");
  });
});

test("cswitch --help lists copy", () => {
  withFakeHome((home) => {
    const result = runCli(home, ["--help"]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /copy <src> <dst>/);
  });
});
