import { realpathSync } from "node:fs";
import path from "node:path";

/**
 * Whether the running cswitch script lives in a directory that's on PATH —
 * a cheap proxy for "installed as a global bin" (spec §6.2 step 7). Used to
 * warn when the Shell Hook wouldn't find `cswitch` (e.g. running via `npx`
 * or straight from a source checkout, as the test suite does).
 */
export function isInGlobalBinDir(
  scriptPath: string,
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform = process.platform,
): boolean {
  let resolvedScriptDir: string;
  try {
    resolvedScriptDir = path.dirname(realpathSync.native(scriptPath));
  } catch {
    return false;
  }

  const pathVarName = platform === "win32" ? (env.PATH !== undefined ? "PATH" : "Path") : "PATH";
  const pathValue = env[pathVarName] ?? "";
  const dirs = pathValue.split(path.delimiter).filter((d) => d.length > 0);

  for (const dir of dirs) {
    try {
      if (realpathSync.native(dir) === resolvedScriptDir) {
        return true;
      }
    } catch {
      continue;
    }
  }
  return false;
}
