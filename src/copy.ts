import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ConfigError, cswitchHomePath, readConfig, type Config, type ProfileRecord } from "./config.js";
import { EXIT_OK, EXIT_RUNTIME, EXIT_USAGE } from "./exit-codes.js";
import { profileClaudeJsonPath, profileSettingsPath } from "./launch.js";

/** The three keys `copy` moves (copy ticket §K1) — everything else in either file is left alone. */
export type CopySection = "enabledPlugins" | "extraKnownMarketplaces" | "mcpServers";

/** Which of a profile's two documents a section lives in. */
export type CopyFileKind = "settings" | "claudeJson";

/** The category flags a section answers to (copy ticket §K3). */
export type CopyCategory = "plugins" | "mcp";

interface SectionSpec {
  section: CopySection;
  file: CopyFileKind;
  category: CopyCategory;
  /** What the report calls this section. */
  label: string;
}

/** The single table every part of `copy` reads: what moves, from which file, under which flag. */
const SECTIONS: readonly SectionSpec[] = [
  { section: "enabledPlugins", file: "settings", category: "plugins", label: "plugins" },
  { section: "extraKnownMarketplaces", file: "settings", category: "plugins", label: "marketplaces" },
  { section: "mcpServers", file: "claudeJson", category: "mcp", label: "MCP servers" },
];

const FILE_LABEL: Record<CopyFileKind, string> = { settings: "settings.json", claudeJson: ".claude.json" };

export interface CopyEntry {
  section: CopySection;
  key: string;
  status: "added" | "overwritten" | "unchanged";
  /** The target's value before the copy — only set for `overwritten`. */
  before?: unknown;
  after: unknown;
}

export interface CopyFileWrite {
  kind: CopyFileKind;
  path: string;
  /** The whole document as it should be written — the merge already applied. */
  content: Record<string, unknown>;
}

export interface CopyPlan {
  sourceName: string;
  targetName: string;
  targetInPlace: boolean;
  entries: CopyEntry[];
  /** Only the files whose contents actually change; empty when there is nothing to do. */
  writes: CopyFileWrite[];
  /** True when at least one MCP server is added or overwritten (drives the §K6 warning). */
  copiedMcpServers: boolean;
}

export type PlanCopyOutcome = { ok: true; plan: CopyPlan } | { ok: false; message: string; exitCode: number };

export interface PlanCopyParams {
  home: string;
  cswitchHome: string;
  config: Config;
  source: string;
  target: string;
  plugins: boolean;
  mcp: boolean;
}

class JsonReadError extends Error {}

/** One side of the copy: both documents, with the paths they came from. */
interface ProfileFiles {
  settings: { path: string; document: Record<string, unknown> };
  claudeJson: { path: string; document: Record<string, unknown> };
}

/**
 * Reads a JSON document that may legitimately not exist yet (a profile that has
 * never been launched). Missing is `{}`; unreadable or malformed is fatal, so a
 * copy never silently discards a file it could not understand (copy ticket §K11).
 */
function readJsonDocument(filePath: string, label: string): Record<string, unknown> {
  let raw: string;
  try {
    raw = readFileSync(filePath, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return {};
    }
    throw new JsonReadError(`cswitch copy: could not read ${label}: ${(err as Error).message}`);
  }

  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new JsonReadError(`cswitch copy: ${label} is not valid JSON`);
  }

  if (!isPlainObject(data)) {
    throw new JsonReadError(`cswitch copy: ${label} is not a JSON object`);
  }
  return data;
}

function readProfileFiles(home: string, cswitchHome: string, record: ProfileRecord): ProfileFiles {
  const settingsFile = profileSettingsPath(home, cswitchHome, record);
  const claudeJsonFile = profileClaudeJsonPath(home, cswitchHome, record);
  return {
    settings: { path: settingsFile, document: readJsonDocument(settingsFile, `${record.name}'s settings.json`) },
    claudeJson: { path: claudeJsonFile, document: readJsonDocument(claudeJsonFile, `${record.name}'s .claude.json`) },
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * A section is an object keyed by plugin/marketplace/server name. A section that
 * is present but is something else is a hard error rather than an empty object:
 * merging into it would drop whatever was there, and §K5 promises nothing is ever
 * deleted.
 */
function readSection(files: ProfileFiles, spec: SectionSpec, profileName: string): Record<string, unknown> {
  const value = files[spec.file].document[spec.section];
  if (value === undefined) {
    return {};
  }
  if (!isPlainObject(value)) {
    throw new JsonReadError(
      `cswitch copy: ${profileName}'s ${FILE_LABEL[spec.file]} has a \`${spec.section}\` that is not a JSON object`,
    );
  }
  return value;
}

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

/**
 * Builds the whole copy in memory (copy ticket §K8): reads both profiles, merges
 * the three keys with "source wins, nothing is ever deleted" (§K5), and returns
 * what would change. Touches no file — `applyCopy` is the only writer, and
 * `--dry-run` is just this half on its own.
 */
export function planCopy(params: PlanCopyParams): PlanCopyOutcome {
  const { home, cswitchHome, config, source, target, plugins, mcp } = params;

  const sourceRecord = config.profiles.find((p) => p.name === source);
  if (sourceRecord === undefined) {
    return { ok: false, message: notFoundMessage(source), exitCode: EXIT_USAGE };
  }
  const targetRecord = config.profiles.find((p) => p.name === target);
  if (targetRecord === undefined) {
    return { ok: false, message: notFoundMessage(target), exitCode: EXIT_USAGE };
  }

  const wanted = new Set<CopyCategory>([...(plugins ? (["plugins"] as const) : []), ...(mcp ? (["mcp"] as const) : [])]);
  const sections = SECTIONS.filter((spec) => wanted.has(spec.category));

  const entries: CopyEntry[] = [];
  let sourceFiles: ProfileFiles;
  let targetFiles: ProfileFiles;
  let merged: Record<CopyFileKind, Record<string, unknown>>;
  const changed: Record<CopyFileKind, boolean> = { settings: false, claudeJson: false };
  let copiedMcpServers = false;

  try {
    sourceFiles = readProfileFiles(home, cswitchHome, sourceRecord);
    targetFiles = readProfileFiles(home, cswitchHome, targetRecord);
    merged = { settings: { ...targetFiles.settings.document }, claudeJson: { ...targetFiles.claudeJson.document } };

    for (const spec of sections) {
      const from = readSection(sourceFiles, spec, source);
      const to = readSection(targetFiles, spec, target);
      const next = { ...to };

      for (const key of Object.keys(from)) {
        const after = from[key];
        if (!(key in to)) {
          entries.push({ section: spec.section, key, status: "added", after });
        } else if (deepEqual(to[key], after)) {
          entries.push({ section: spec.section, key, status: "unchanged", after });
          continue;
        } else {
          entries.push({ section: spec.section, key, status: "overwritten", before: to[key], after });
        }
        next[key] = after;
        changed[spec.file] = true;
        if (spec.category === "mcp") {
          copiedMcpServers = true;
        }
      }

      if (Object.keys(next).length > 0) {
        merged[spec.file][spec.section] = next;
      }
    }
  } catch (err) {
    return { ok: false, message: (err as JsonReadError).message, exitCode: EXIT_RUNTIME };
  }

  const writes: CopyFileWrite[] = (["settings", "claudeJson"] as const)
    .filter((kind) => changed[kind])
    .map((kind) => ({ kind, path: targetFiles[kind].path, content: merged[kind] }));

  return {
    ok: true,
    plan: {
      sourceName: source,
      targetName: target,
      targetInPlace: targetRecord.inPlace === true,
      entries,
      writes,
      copiedMcpServers,
    },
  };
}

function notFoundMessage(name: string): string {
  return `cswitch: no profile named "${name}" in ~/.cswitch/config.json`;
}

/** The `.bak-<timestamp>` suffix, with the colons an ISO stamp carries flattened for Windows. */
export function backupPathFor(filePath: string, now: Date): string {
  return `${filePath}.bak-${now.toISOString().replace(/[:.]/g, "-")}`;
}

export interface ApplyCopyResult {
  backups: string[];
}

/**
 * Writes a plan (copy ticket §K8). When the target is the in-place profile, each
 * file it is about to touch is copied aside first (§K7): those are the files the
 * user set up by hand, and cswitch did not create them.
 */
export function applyCopy(plan: CopyPlan, now: Date = new Date()): ApplyCopyResult {
  const backups: string[] = [];

  for (const write of plan.writes) {
    if (plan.targetInPlace && existsSync(write.path)) {
      const backup = backupPathFor(write.path, now);
      copyFileSync(write.path, backup);
      backups.push(backup);
    }
    mkdirSync(path.dirname(write.path), { recursive: true });
    writeFileSync(write.path, `${JSON.stringify(write.content, null, 2)}\n`, "utf8");
  }

  return { backups };
}

const VALUE_WIDTH = 48;

/** A value as one short line — MCP server entries are objects, and `…` alone says nothing. */
function formatValue(value: unknown): string {
  const text = JSON.stringify(value) ?? "undefined";
  return text.length <= VALUE_WIDTH ? text : `${text.slice(0, VALUE_WIDTH - 1)}…`;
}

/** The per-key report (copy ticket §K10), in `add`'s house style. */
export function formatCopyPlan(plan: CopyPlan): string {
  const lines: string[] = [];

  for (const spec of SECTIONS) {
    const entries = plan.entries.filter((e) => e.section === spec.section);
    if (entries.length === 0) {
      continue;
    }
    lines.push(`  ${spec.label}`);
    for (const entry of entries) {
      if (entry.status === "added") {
        lines.push(`    + ${entry.key} added`);
      } else if (entry.status === "overwritten") {
        lines.push(`    ~ ${entry.key} overwritten (${formatValue(entry.before)} → ${formatValue(entry.after)})`);
      } else {
        lines.push(`    = ${entry.key} unchanged`);
      }
    }
  }

  return lines.join("\n");
}

function summarize(plan: CopyPlan): string {
  const count = (status: CopyEntry["status"]) => plan.entries.filter((e) => e.status === status).length;
  return `${count("added")} added, ${count("overwritten")} overwritten, ${count("unchanged")} unchanged`;
}

/** The §K6 reminder: server configs travel, their credentials never do. */
function credentialsNote(target: string): string {
  return `\nNote: MCP credentials are never copied. Servers that need a login must be re-authenticated in "${target}" with \`/mcp\`.\n`;
}

export interface RunCopyParams {
  home: string;
  source: string;
  target: string;
  plugins: boolean;
  mcp: boolean;
  dryRun: boolean;
}

/** `cswitch copy <source> <target>` — plan, report, then write unless `--dry-run`. */
export function runCopy(params: RunCopyParams): number {
  const { home, source, target, plugins, mcp, dryRun } = params;
  const cswitchHome = cswitchHomePath(home);

  let config: Config | undefined;
  try {
    config = readConfig(cswitchHome);
  } catch (err) {
    process.stderr.write(`${(err as ConfigError).message}\n`);
    return EXIT_RUNTIME;
  }
  if (config === undefined) {
    process.stderr.write('cswitch: ~/.cswitch not found. Run "cswitch init" first.\n');
    return EXIT_RUNTIME;
  }

  const outcome = planCopy({ home, cswitchHome, config, source, target, plugins, mcp });
  if (!outcome.ok) {
    process.stderr.write(`${outcome.message}\n`);
    return outcome.exitCode;
  }

  const { plan } = outcome;
  if (plan.entries.length === 0) {
    // Nothing to copy is an outcome, not a failure (copy ticket §K11).
    process.stdout.write(`\nNothing to copy from "${source}" to "${target}".\n`);
    return EXIT_OK;
  }

  process.stdout.write(`\n${formatCopyPlan(plan)}\n`);

  if (dryRun) {
    process.stdout.write(`\n  ${summarize(plan)} — nothing written (--dry-run)\n`);
    if (plan.copiedMcpServers) {
      process.stdout.write(credentialsNote(target));
    }
    return EXIT_OK;
  }

  let result: ApplyCopyResult;
  try {
    result = applyCopy(plan);
  } catch (err) {
    process.stderr.write(`cswitch copy: failed to write "${target}": ${(err as Error).message}\n`);
    return EXIT_RUNTIME;
  }

  process.stdout.write(`\n  ${summarize(plan)} → ${target}\n`);
  for (const backup of result.backups) {
    process.stdout.write(`  backed up ${path.basename(backup)}\n`);
  }
  if (plan.copiedMcpServers) {
    process.stdout.write(credentialsNote(target));
  }

  return EXIT_OK;
}
