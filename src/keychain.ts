import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import os from "node:os";

export type KeychainDeleteResult =
  | { kind: "ok" }
  | { kind: "not-found" }
  | { kind: "warning"; message: string };

export interface SecuritySpawnResult {
  status: number | null;
  error?: Error;
}

/** Runs `/usr/bin/security` with an argument array (never a shell string) — same
 * spawn shape as the Launcher's own `claude` invocation (spec §10.9). Injectable
 * so tests never touch the real macOS Keychain. */
export type SpawnSecurity = (args: string[]) => SecuritySpawnResult;

export function defaultSpawnSecurity(args: string[]): SecuritySpawnResult {
  const result = spawnSync("/usr/bin/security", args, { stdio: "ignore" });
  return { status: result.status, error: result.error };
}

/**
 * The Keychain service name for a profile's config dir — UNVERIFIED (spec §10.9): no
 * official Anthropic source, and the pattern has changed once before. Best guess from
 * an independent report: `Claude Code-credentials-${sha256(configDir).slice(0, 8)}`.
 */
export function keychainServiceName(configDir: string): string {
  const hash = createHash("sha256").update(configDir).digest("hex").slice(0, 8);
  return `Claude Code-credentials-${hash}`;
}

/** The Keychain account name — the OS username, per the same unverified report. */
export function keychainAccountName(): string {
  return os.userInfo().username;
}

/**
 * Best-effort deletes a profile's macOS Keychain entry (spec §10.9): "not found" (exit
 * 44, macOS's general errSecItemNotFound) is a silent no-op, since an abandoned profile
 * may never have logged in. Any other non-zero exit, or a spawn failure, is reported as
 * a warning — never a hard error — because a wrong service/account guess (this pattern
 * is unverified) must not leave the user stuck with a half-deleted profile.
 */
export function deleteKeychainEntry(configDir: string, spawnSecurity: SpawnSecurity = defaultSpawnSecurity): KeychainDeleteResult {
  const service = keychainServiceName(configDir);
  const account = keychainAccountName();
  const { status, error } = spawnSecurity(["delete-generic-password", "-s", service, "-a", account]);

  if (error) {
    return { kind: "warning", message: `cswitch: could not run "security" to clean up the Keychain entry: ${error.message}` };
  }
  if (status === 0) {
    return { kind: "ok" };
  }
  if (status === 44) {
    return { kind: "not-found" };
  }
  return { kind: "warning", message: `cswitch: Keychain cleanup exited with code ${status} — the entry may still be present` };
}
