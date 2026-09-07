import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { Config } from "../src/config.js";
import { applyCopy, backupPathFor, formatCopyPlan, planCopy, type CopyPlan } from "../src/copy.js";
import { EXIT_RUNTIME, EXIT_USAGE } from "../src/exit-codes.js";

const CONFIG: Config = {
  version: 1,
  profiles: [{ name: "work" }, { name: "personal" }],
  bindings: [],
};

interface Fixture {
  home: string;
  cswitchHome: string;
  /** Writes raw text, so a test can plant malformed JSON. */
  write: (profile: string, file: "settings.json" | ".claude.json", contents: string | object) => void;
  read: (profile: string, file: "settings.json" | ".claude.json") => Record<string, unknown>;
}

function withFixture(fn: (fixture: Fixture) => void): void {
  const home = mkdtempSync(path.join(os.tmpdir(), "cswitch-copy-unit-"));
  const cswitchHome = path.join(home, ".cswitch");
  const profileDir = (profile: string) => path.join(cswitchHome, "profiles", profile);
  try {
    for (const profile of ["work", "personal"]) {
      mkdirSync(profileDir(profile), { recursive: true });
    }
    fn({
      home,
      cswitchHome,
      write: (profile, file, contents) => {
        const text = typeof contents === "string" ? contents : JSON.stringify(contents, null, 2);
        writeFileSync(path.join(profileDir(profile), file), text, "utf8");
      },
      read: (profile, file) => JSON.parse(readFileSync(path.join(profileDir(profile), file), "utf8")),
    });
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

function plan(fixture: Fixture, overrides: { plugins?: boolean; mcp?: boolean } = {}): CopyPlan {
  const outcome = planCopy({
    home: fixture.home,
    cswitchHome: fixture.cswitchHome,
    config: CONFIG,
    source: "work",
    target: "personal",
    plugins: overrides.plugins ?? true,
    mcp: overrides.mcp ?? true,
  });
  assert.equal(outcome.ok, true, outcome.ok ? "" : outcome.message);
  return (outcome as { plan: CopyPlan }).plan;
}

test("planCopy: an empty target gets every source key as added", () => {
  withFixture((fixture) => {
    fixture.write("work", "settings.json", {
      enabledPlugins: { "a@market": true, "b@market": false },
      extraKnownMarketplaces: { market: { source: { source: "github", repo: "x/y" } } },
      model: "opus",
    });
    fixture.write("work", ".claude.json", { mcpServers: { linear: { type: "http", url: "https://x" } } });

    const result = plan(fixture);

    assert.deepEqual(
      result.entries.map((e) => [e.section, e.key, e.status]),
      [
        ["enabledPlugins", "a@market", "added"],
        ["enabledPlugins", "b@market", "added"],
        ["extraKnownMarketplaces", "market", "added"],
        ["mcpServers", "linear", "added"],
      ],
    );
    assert.equal(result.copiedMcpServers, true);
    assert.equal(result.writes.length, 2);

    const settingsWrite = result.writes.find((w) => w.kind === "settings")!;
    // The rest of settings.json is not this command's business (§K1).
    assert.equal(settingsWrite.content.model, undefined);
    assert.deepEqual(settingsWrite.content.enabledPlugins, { "a@market": true, "b@market": false });
  });
});

test("planCopy: a conflicting key is overwritten by the source, with both values recorded", () => {
  withFixture((fixture) => {
    fixture.write("work", "settings.json", { enabledPlugins: { "a@market": true } });
    fixture.write("personal", "settings.json", { enabledPlugins: { "a@market": false } });

    const result = plan(fixture);

    assert.deepEqual(result.entries, [
      { section: "enabledPlugins", key: "a@market", status: "overwritten", before: false, after: true },
    ]);
    assert.deepEqual(result.writes[0]!.content.enabledPlugins, { "a@market": true });
  });
});

test("planCopy: an identical key on both sides is unchanged and writes nothing", () => {
  withFixture((fixture) => {
    fixture.write("work", "settings.json", { enabledPlugins: { "a@market": true } });
    fixture.write("personal", "settings.json", { enabledPlugins: { "a@market": true } });

    const result = plan(fixture);

    assert.deepEqual(
      result.entries.map((e) => e.status),
      ["unchanged"],
    );
    assert.deepEqual(result.writes, []);
  });
});

test("planCopy: a key only the target has survives the merge (§K5)", () => {
  withFixture((fixture) => {
    fixture.write("work", "settings.json", { enabledPlugins: { "a@market": true } });
    fixture.write("personal", "settings.json", {
      enabledPlugins: { "only-here@market": true },
      theme: "dark",
    });

    const result = plan(fixture);

    const content = result.writes[0]!.content;
    assert.deepEqual(content.enabledPlugins, { "only-here@market": true, "a@market": true });
    // Untouched keys of the target's own file are preserved too.
    assert.equal(content.theme, "dark");
  });
});

test("planCopy: --plugins leaves the MCP servers alone", () => {
  withFixture((fixture) => {
    fixture.write("work", "settings.json", { enabledPlugins: { "a@market": true } });
    fixture.write("work", ".claude.json", { mcpServers: { linear: { url: "https://x" } } });

    const result = plan(fixture, { plugins: true, mcp: false });

    assert.deepEqual(
      result.entries.map((e) => e.section),
      ["enabledPlugins"],
    );
    assert.equal(result.copiedMcpServers, false);
    assert.deepEqual(
      result.writes.map((w) => w.kind),
      ["settings"],
    );
  });
});

test("planCopy: --mcp leaves the plugin keys alone", () => {
  withFixture((fixture) => {
    fixture.write("work", "settings.json", { enabledPlugins: { "a@market": true } });
    fixture.write("work", ".claude.json", { mcpServers: { linear: { url: "https://x" } } });

    const result = plan(fixture, { plugins: false, mcp: true });

    assert.deepEqual(
      result.entries.map((e) => e.section),
      ["mcpServers"],
    );
    assert.deepEqual(
      result.writes.map((w) => w.kind),
      ["claudeJson"],
    );
  });
});

test("planCopy: project-scope MCP records are out of scope", () => {
  withFixture((fixture) => {
    fixture.write("work", ".claude.json", {
      projects: { "/some/dir": { mcpServers: { scoped: { url: "https://x" } } } },
    });

    const result = plan(fixture);

    assert.deepEqual(result.entries, []);
    assert.deepEqual(result.writes, []);
  });
});

test("planCopy: nothing to copy yields an empty plan, not an error", () => {
  withFixture((fixture) => {
    const result = plan(fixture);
    assert.deepEqual(result.entries, []);
    assert.deepEqual(result.writes, []);
  });
});

test("planCopy: an unknown profile name is a usage error", () => {
  withFixture((fixture) => {
    const outcome = planCopy({
      home: fixture.home,
      cswitchHome: fixture.cswitchHome,
      config: CONFIG,
      source: "ghost",
      target: "personal",
      plugins: true,
      mcp: true,
    });
    assert.equal(outcome.ok, false);
    assert.equal((outcome as { exitCode: number }).exitCode, EXIT_USAGE);
    assert.match((outcome as { message: string }).message, /no profile named "ghost"/);
  });
});

test("planCopy: malformed JSON on either side is a runtime error and plans nothing", () => {
  withFixture((fixture) => {
    fixture.write("work", "settings.json", "{ not json");

    const outcome = planCopy({
      home: fixture.home,
      cswitchHome: fixture.cswitchHome,
      config: CONFIG,
      source: "work",
      target: "personal",
      plugins: true,
      mcp: true,
    });
    assert.equal(outcome.ok, false);
    assert.equal((outcome as { exitCode: number }).exitCode, EXIT_RUNTIME);
    assert.match((outcome as { message: string }).message, /settings\.json is not valid JSON/);
  });
});

test("planCopy: a malformed target file is a runtime error too", () => {
  withFixture((fixture) => {
    fixture.write("work", "settings.json", { enabledPlugins: { "a@market": true } });
    fixture.write("personal", "settings.json", "[]");

    const outcome = planCopy({
      home: fixture.home,
      cswitchHome: fixture.cswitchHome,
      config: CONFIG,
      source: "work",
      target: "personal",
      plugins: true,
      mcp: true,
    });
    assert.equal(outcome.ok, false);
    assert.equal((outcome as { exitCode: number }).exitCode, EXIT_RUNTIME);
    assert.match((outcome as { message: string }).message, /is not a JSON object/);
  });
});

test("applyCopy: writes the planned files and leaves the source untouched", () => {
  withFixture((fixture) => {
    fixture.write("work", "settings.json", { enabledPlugins: { "a@market": true } });
    fixture.write("work", ".claude.json", { mcpServers: { linear: { url: "https://x" } } });

    const result = applyCopy(plan(fixture));

    assert.deepEqual(result.backups, []);
    assert.deepEqual(fixture.read("personal", "settings.json").enabledPlugins, { "a@market": true });
    assert.deepEqual(fixture.read("personal", ".claude.json").mcpServers, { linear: { url: "https://x" } });
    assert.deepEqual(fixture.read("work", "settings.json"), { enabledPlugins: { "a@market": true } });
  });
});

test("backupPathFor: the stamp carries no characters Windows rejects in a filename", () => {
  const backup = backupPathFor("C:\\x\\settings.json", new Date("2026-09-07T12:34:56.789Z"));
  assert.equal(backup, "C:\\x\\settings.json.bak-2026-09-07T12-34-56-789Z");
});

test("formatCopyPlan: reports one line per key, grouped by section", () => {
  withFixture((fixture) => {
    fixture.write("work", "settings.json", { enabledPlugins: { "a@market": true, "same@market": true } });
    fixture.write("work", ".claude.json", { mcpServers: { linear: { url: "https://x" } } });
    fixture.write("personal", "settings.json", { enabledPlugins: { "a@market": false, "same@market": true } });

    assert.equal(
      formatCopyPlan(plan(fixture)),
      [
        "  plugins",
        "    ~ a@market overwritten (false → true)",
        "    = same@market unchanged",
        "  MCP servers",
        "    + linear added",
      ].join("\n"),
    );
  });
});

test("planCopy: a target section that is not an object is refused, never merged over", () => {
  withFixture((fixture) => {
    fixture.write("work", "settings.json", { enabledPlugins: { "a@market": true } });
    // Parseable JSON, so §K11's "malformed" case does not catch it — but merging
    // into it would delete whatever the user had there, which §K5 forbids.
    fixture.write("personal", "settings.json", { enabledPlugins: ["a@market"] });

    const outcome = planCopy({
      home: fixture.home,
      cswitchHome: fixture.cswitchHome,
      config: CONFIG,
      source: "work",
      target: "personal",
      plugins: true,
      mcp: true,
    });
    assert.equal(outcome.ok, false);
    assert.equal((outcome as { exitCode: number }).exitCode, EXIT_RUNTIME);
    assert.match((outcome as { message: string }).message, /`enabledPlugins` that is not a JSON object/);
  });
});

test("formatCopyPlan: an overwritten object value shows what it is, not just an ellipsis", () => {
  withFixture((fixture) => {
    fixture.write("work", ".claude.json", { mcpServers: { linear: { url: "https://new" } } });
    fixture.write("personal", ".claude.json", { mcpServers: { linear: { url: "https://old" } } });

    const report = formatCopyPlan(plan(fixture));

    assert.match(report, /~ linear overwritten \(\{"url":"https:\/\/old"\} → \{"url":"https:\/\/new"\}\)/);
  });
});
