import { readFileSync } from "node:fs";

export type AccountDisplay =
  | { kind: "not-logged-in" }
  | { kind: "unknown" }
  | { kind: "known"; emailAddress: string; organizationName?: string };

/**
 * Reads `oauthAccount` out of a `.claude.json` file, gracefully (spec §5.6).
 * Never throws: a missing file or missing field reads as "not logged in"
 * (the expected state for a fresh profile); a present-but-corrupt file, or
 * one whose `oauthAccount` shape has drifted, reads as "unknown" (a failure
 * signal). `emailAddress` is the only field this ever requires.
 */
export function readAccount(claudeJsonPath: string): AccountDisplay {
  let raw: string;
  try {
    raw = readFileSync(claudeJsonPath, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return { kind: "not-logged-in" };
    }
    // File exists but couldn't be read (permissions, I/O error, ...): a failure signal, not "no account".
    return { kind: "unknown" };
  }

  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return { kind: "unknown" };
  }

  if (typeof data !== "object" || data === null) {
    return { kind: "unknown" };
  }

  const oauthAccount = (data as Record<string, unknown>).oauthAccount;
  if (oauthAccount === undefined) {
    return { kind: "not-logged-in" };
  }
  if (typeof oauthAccount !== "object" || oauthAccount === null) {
    return { kind: "unknown" };
  }

  const emailAddress = (oauthAccount as Record<string, unknown>).emailAddress;
  if (typeof emailAddress !== "string" || emailAddress.length === 0) {
    return { kind: "unknown" };
  }

  const organizationNameRaw = (oauthAccount as Record<string, unknown>).organizationName;
  const organizationName =
    typeof organizationNameRaw === "string" && organizationNameRaw.length > 0 ? organizationNameRaw : undefined;

  return { kind: "known", emailAddress, organizationName };
}

export function formatAccount(display: AccountDisplay): string {
  switch (display.kind) {
    case "not-logged-in":
      return "(not logged in)";
    case "unknown":
      return "(account unknown)";
    case "known":
      return display.organizationName ? `${display.emailAddress} · ${display.organizationName}` : display.emailAddress;
  }
}
