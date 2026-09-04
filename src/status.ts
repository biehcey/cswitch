import { formatAccount, readAccount, type AccountDisplay } from "./account.js";
import { looksCanonical } from "./binding.js";
import { ConfigError, cswitchHomePath, readConfig, type Config } from "./config.js";
import { EXIT_OK, EXIT_RUNTIME } from "./exit-codes.js";
import { inspectPluginsJunction, profileClaudeJsonPath, resolveCwdBinding, resolveLaunchProfile } from "./launch.js";

export type LoginState = "logged-in" | "not-logged-in" | "unknown";

export function loginStateOf(account: AccountDisplay): LoginState {
  switch (account.kind) {
    case "known":
      return "logged-in";
    case "not-logged-in":
      return "not-logged-in";
    case "unknown":
      return "unknown";
  }
}

export type HereStatus =
  | {
      kind: "resolved";
      cwd: string;
      profile: string;
      usedDefault: boolean;
      bindingPrefix?: string;
      account: AccountDisplay;
    }
  | { kind: "no-default"; cwd: string };

export interface ProfileStatus {
  name: string;
  inPlace: boolean;
  account: AccountDisplay;
}

export type StatusWarning =
  | { kind: "junction"; profile: string; detail: string }
  | { kind: "unbound-profile"; prefix: string; profile: string }
  | { kind: "duplicate-account"; accountUuid: string; profiles: string[] }
  | { kind: "non-canonical-binding"; prefix: string };

export interface StatusReport {
  here: HereStatus;
  profiles: ProfileStatus[];
  warnings: StatusWarning[];
}

export interface BuildStatusParams {
  home: string;
  cswitchHome: string;
  config: Config;
  cwd: string;
}

/**
 * Assembles everything `status` shows (spec §6.6): entirely local, never touches the
 * network or spawns `claude`. Reuses the same profile-resolution logic the launcher runs
 * (resolveCwdBinding / resolveLaunchProfile) so "what would run here" can never drift from
 * what actually runs — status is a read-only view onto the launcher's own decision.
 */
export function buildStatusReport(params: BuildStatusParams): StatusReport {
  const { home, cswitchHome, config, cwd } = params;
  const warnings: StatusWarning[] = [];

  const matchedBinding = resolveCwdBinding(config, undefined, cwd, () => {});
  const hereResolution = resolveLaunchProfile(config, undefined, matchedBinding);

  const here: HereStatus =
    hereResolution.kind === "resolved"
      ? {
          kind: "resolved",
          cwd,
          profile: hereResolution.record.name,
          usedDefault: hereResolution.usedDefault,
          bindingPrefix: hereResolution.usedDefault ? undefined : matchedBinding?.prefix,
          account: readAccount(profileClaudeJsonPath(home, cswitchHome, hereResolution.record)),
        }
      : { kind: "no-default", cwd };

  const profiles: ProfileStatus[] = config.profiles.map((record) => ({
    name: record.name,
    inPlace: record.inPlace === true,
    account: readAccount(profileClaudeJsonPath(home, cswitchHome, record)),
  }));

  for (const record of config.profiles) {
    if (record.inPlace) {
      continue;
    }
    const inspection = inspectPluginsJunction(home, cswitchHome, record);
    if (inspection.kind === "broken") {
      warnings.push({ kind: "junction", profile: record.name, detail: `is broken — target missing (${inspection.target})` });
    } else if (inspection.kind === "wrong-target") {
      warnings.push({ kind: "junction", profile: record.name, detail: `points at the wrong target (${inspection.target})` });
    } else if (inspection.kind === "not-a-junction") {
      warnings.push({ kind: "junction", profile: record.name, detail: "is a real, non-empty directory, not a junction" });
    }
  }

  for (const binding of config.bindings) {
    if (!config.profiles.some((p) => p.name === binding.profile)) {
      warnings.push({ kind: "unbound-profile", prefix: binding.prefix, profile: binding.profile });
    }
  }

  const profilesByAccountUuid = new Map<string, string[]>();
  for (const profile of profiles) {
    if (profile.account.kind !== "known" || profile.account.accountUuid === undefined) {
      continue;
    }
    const names = profilesByAccountUuid.get(profile.account.accountUuid) ?? [];
    names.push(profile.name);
    profilesByAccountUuid.set(profile.account.accountUuid, names);
  }
  for (const [accountUuid, names] of profilesByAccountUuid) {
    if (names.length > 1) {
      warnings.push({ kind: "duplicate-account", accountUuid, profiles: names });
    }
  }

  for (const binding of config.bindings) {
    if (!looksCanonical(binding.prefix)) {
      warnings.push({ kind: "non-canonical-binding", prefix: binding.prefix });
    }
  }

  return { here, profiles, warnings };
}

function formatWarning(warning: StatusWarning): string {
  switch (warning.kind) {
    case "junction":
      return `${warning.profile}: plugins/ junction ${warning.detail}`;
    case "unbound-profile":
      return `binding ${warning.prefix} points at unknown profile "${warning.profile}"`;
    case "duplicate-account":
      return `profiles ${warning.profiles.map((name) => `"${name}"`).join(", ")} share the same account — this defeats the point of separate profiles`;
    case "non-canonical-binding":
      return `binding prefix "${warning.prefix}" is not in canonical form (hand-edited config.json?)`;
  }
}

/** Plain-text rendering (spec §6.6): formatting is not a promise here — `--json` is. */
export function formatStatusText(report: StatusReport): string {
  const blocks: string[] = [];

  const hereLines: string[] = [`Here: ${report.here.cwd}`];
  if (report.here.kind === "resolved") {
    const reason = report.here.usedDefault ? "(no binding — default)" : `(binding: ${report.here.bindingPrefix})`;
    hereLines.push(`  Profile   ${report.here.profile}  ${reason}`);
    hereLines.push(`  Account   ${formatAccount(report.here.account)}`);
  } else {
    hereLines.push("  no default profile is registered — run `cswitch init` first");
  }
  blocks.push(hereLines.join("\n"));

  const profileLines = ["Profiles"];
  for (const profile of report.profiles) {
    const marker = profile.inPlace ? " *" : "";
    const inPlaceNote = profile.inPlace ? "  (* in place: ~/.claude)" : "";
    profileLines.push(`  ${profile.name}${marker}  ${formatAccount(profile.account)}${inPlaceNote}`);
  }
  blocks.push(profileLines.join("\n"));

  if (report.warnings.length > 0) {
    const warningLines = ["Warnings", ...report.warnings.map((w) => `  ! ${formatWarning(w)}`)];
    blocks.push(warningLines.join("\n"));
  }

  return `${blocks.join("\n\n")}\n`;
}

function accountToJson(account: AccountDisplay): Record<string, unknown> {
  return {
    loginState: loginStateOf(account),
    ...(account.kind === "known" ? { emailAddress: account.emailAddress } : {}),
    ...(account.kind === "known" && account.organizationName !== undefined
      ? { organizationName: account.organizationName }
      : {}),
    ...(account.kind === "known" && account.accountUuid !== undefined ? { accountUuid: account.accountUuid } : {}),
  };
}

/** `--json` rendering (spec §6.6): the structure `--json` promises, with `here`/`profiles`/`warnings` keys. */
export function statusReportToJson(report: StatusReport): Record<string, unknown> {
  return {
    here:
      report.here.kind === "resolved"
        ? {
            cwd: report.here.cwd,
            profile: report.here.profile,
            usedDefault: report.here.usedDefault,
            bindingPrefix: report.here.bindingPrefix,
            account: accountToJson(report.here.account),
          }
        : { cwd: report.here.cwd, profile: undefined },
    profiles: report.profiles.map((p) => ({ name: p.name, inPlace: p.inPlace, account: accountToJson(p.account) })),
    warnings: report.warnings.map((w) => ({ ...w, message: formatWarning(w) })),
  };
}

export interface RunStatusParams {
  home: string;
  cwd: string;
  json: boolean;
}

/** `cswitch status [--json]` (spec §6.6). */
export function runStatus(params: RunStatusParams): number {
  const { home, cwd, json } = params;
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

  const report = buildStatusReport({ home, cswitchHome, config, cwd });

  if (json) {
    process.stdout.write(`${JSON.stringify(statusReportToJson(report), null, 2)}\n`);
  } else {
    process.stdout.write(formatStatusText(report));
  }

  return EXIT_OK;
}
