import { realpathSync } from "node:fs";
import path from "node:path";
import type { Binding } from "./config.js";
import type { Io } from "./io.js";

export class BindingPathError extends Error {}

const CASE_INSENSITIVE_PLATFORMS = new Set(["win32", "darwin"]);

function expandTilde(input: string, home: string): string {
  if (input === "~") {
    return home;
  }
  if (input.startsWith("~/") || input.startsWith("~\\")) {
    return path.join(home, input.slice(2));
  }
  return input;
}

/**
 * Canonicalizes a directory for storage or comparison (spec §4.1): `~` is
 * expanded against `home`, then the result is passed through
 * `realpath.native`, resolving symlinks and junctions so the same physical
 * directory always yields the same canonical path. The directory must
 * exist. This is the only place a Binding path touches the filesystem —
 * a stored prefix is never re-resolved at match time.
 */
export function canonicalizeDir(input: string, home: string): string {
  const expanded = expandTilde(input, home);
  try {
    return realpathSync.native(expanded);
  } catch {
    throw new BindingPathError(`cswitch: "${input}" does not exist`);
  }
}

/** Like canonicalizeDir, but for `cwd` at match time (spec §4.3): never throws — an
 * unresolvable cwd (deleted, permission error) reads as undefined so the caller can
 * fall back to the Default Profile instead of hard-failing a launch. */
export function tryCanonicalize(absolutePath: string): string | undefined {
  try {
    return realpathSync.native(absolutePath);
  } catch {
    return undefined;
  }
}

/**
 * Splits a canonical path into comparison segments (spec §4.2): NFC
 * normalize (macOS returns NFD), lowercase on case-insensitive platforms
 * only (never `toLocaleLowerCase` — it mangles `I` under a `tr-TR` locale),
 * then split into path segments. Applied only at comparison time; the form
 * written to disk stays canonical.
 */
export function comparisonSegments(canonicalPath: string, platform: NodeJS.Platform = process.platform): string[] {
  let normalized = canonicalPath.normalize("NFC");
  if (CASE_INSENSITIVE_PLATFORMS.has(platform)) {
    normalized = normalized.toLowerCase();
  }
  return normalized.split(/[\\/]+/).filter((segment) => segment.length > 0);
}

function isArrayPrefix(prefix: string[], full: string[]): boolean {
  return prefix.length <= full.length && prefix.every((segment, i) => segment === full[i]);
}

/** Whether `prefixSegments` is a true segment-wise prefix of `pathSegments` — not a raw
 * string `startsWith`, so a `~/work` Binding never matches `~/workshop` (spec §4.2). */
export function isSegmentPrefix(prefixSegments: string[], pathSegments: string[]): boolean {
  return isArrayPrefix(prefixSegments, pathSegments);
}

/** Whether two canonical paths name the same prefix once comparison rules (§4.2) are
 * applied — used to detect an already-bound prefix, not to match a launch's cwd. */
export function isSamePrefix(a: string, b: string, platform: NodeJS.Platform = process.platform): boolean {
  const segA = comparisonSegments(a, platform);
  const segB = comparisonSegments(b, platform);
  return segA.length === segB.length && isArrayPrefix(segA, segB);
}

/**
 * Resolves which Binding, if any, matches `cwdCanonical` (spec §4.3): the
 * longest matching prefix wins, measured in segments. Ties cannot occur —
 * bindings are deduplicated by canonical prefix when written.
 */
export function matchBinding(
  bindings: Binding[],
  cwdCanonical: string,
  platform: NodeJS.Platform = process.platform,
): Binding | undefined {
  const cwdSegments = comparisonSegments(cwdCanonical, platform);
  let best: Binding | undefined;
  let bestLength = -1;
  for (const binding of bindings) {
    const prefixSegments = comparisonSegments(binding.prefix, platform);
    if (isSegmentPrefix(prefixSegments, cwdSegments) && prefixSegments.length > bestLength) {
      best = binding;
      bestLength = prefixSegments.length;
    }
  }
  return best;
}

export type BindingConflictResolution = { kind: "ok" } | { kind: "blocked"; message: string } | { kind: "aborted" };

/**
 * Handles an already-bound canonical prefix the way `bind` documents it
 * (spec §6.5): `--force` overwrites silently, a TTY is asked, and no TTY
 * without `--force` is a hard usage error. Shared by `bind` and by
 * `add --bind`'s reuse of bind's validation (spec §6.3) — `add` never
 * passes `force: true` here on its own, so a genuine conflict there always
 * comes back `blocked`, keeping `add` non-interactive.
 */
export async function resolveBindingConflict(params: {
  bindings: Binding[];
  canonicalDir: string;
  force: boolean;
  io: Io;
}): Promise<BindingConflictResolution> {
  const { bindings, canonicalDir, force, io } = params;
  const existing = bindings.find((b) => isSamePrefix(b.prefix, canonicalDir));
  if (!existing) {
    return { kind: "ok" };
  }
  if (force) {
    return { kind: "ok" };
  }
  if (!io.isTTY) {
    return {
      kind: "blocked",
      message: `cswitch: "${canonicalDir}" is already bound to "${existing.profile}" — pass --force to overwrite`,
    };
  }
  const answer = (
    await io.question(`"${canonicalDir}" is already bound to "${existing.profile}". Overwrite? (y/n) `)
  )
    .trim()
    .toLowerCase();
  if (answer === "y" || answer === "yes") {
    return { kind: "ok" };
  }
  return { kind: "aborted" };
}
