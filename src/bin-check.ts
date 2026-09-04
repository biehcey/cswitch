import { existsSync } from "node:fs";
import path from "node:path";

const WINDOWS_EXECUTABLE_NAMES = ["cswitch", "cswitch.cmd", "cswitch.ps1", "cswitch.exe"];
const POSIX_EXECUTABLE_NAMES = ["cswitch"];

/**
 * Whether a `cswitch` executable is discoverable on PATH — the same check
 * the Shell Hook's own guard performs (`command -v cswitch`). Used to warn
 * when the hook wouldn't find it (spec §6.2 step 7), e.g. running via `npx`
 * or straight from a source checkout, as the test suite does.
 *
 * This deliberately does not require the discovered executable to resolve
 * back to the currently running script: on Windows, a global npm install
 * puts a `cswitch.cmd` shim in the global bin dir that dispatches to the
 * package's real entry point elsewhere, so no realpath of the shim would
 * ever match the running script's own path.
 */
export function isInGlobalBinDir(env: NodeJS.ProcessEnv, platform: NodeJS.Platform = process.platform): boolean {
  const pathValue = platform === "win32" ? (env.PATH ?? env.Path ?? "") : (env.PATH ?? "");
  const dirs = pathValue.split(path.delimiter).filter((d) => d.length > 0);
  const candidateNames = platform === "win32" ? WINDOWS_EXECUTABLE_NAMES : POSIX_EXECUTABLE_NAMES;

  for (const dir of dirs) {
    for (const name of candidateNames) {
      if (existsSync(path.join(dir, name))) {
        return true;
      }
    }
  }
  return false;
}
