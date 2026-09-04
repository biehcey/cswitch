import { canonicalizeDir, isSamePrefix, BindingPathError } from "./binding.js";
import { ConfigError, cswitchHomePath, readConfig, writeConfig, type Config } from "./config.js";
import { EXIT_OK, EXIT_RUNTIME } from "./exit-codes.js";

export interface RunUnbindParams {
  home: string;
  dir: string;
}

/** `cswitch unbind <dir>` (spec §6.5): canonicalizes `dir` the same way `bind` does,
 * then removes the Binding stored for that canonical prefix. Fails if nothing is bound. */
export function runUnbind(params: RunUnbindParams): number {
  const { home, dir } = params;
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

  let canonicalDir: string;
  try {
    canonicalDir = canonicalizeDir(dir, home);
  } catch (err) {
    process.stderr.write(`${(err as BindingPathError).message}\n`);
    return EXIT_RUNTIME;
  }

  const existingIndex = config.bindings.findIndex((b) => isSamePrefix(b.prefix, canonicalDir));
  if (existingIndex === -1) {
    process.stderr.write(`cswitch: nothing is bound to "${canonicalDir}"\n`);
    return EXIT_RUNTIME;
  }

  const removed = config.bindings[existingIndex]!;
  const nextBindings = config.bindings.filter((_, i) => i !== existingIndex);
  writeConfig(cswitchHome, { ...config, bindings: nextBindings });

  process.stdout.write(`  ✓ unbound ${canonicalDir} (was ${removed.profile})\n`);
  return EXIT_OK;
}
