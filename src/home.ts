import os from "node:os";

/**
 * The single seam through which cswitch resolves the user's home directory.
 * Every other module that needs a home path goes through this function so
 * tests can redirect it to a fake directory via CSWITCH_HOME.
 */
export function resolveHome(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.CSWITCH_HOME;
  if (override && override.length > 0) {
    return override;
  }
  return os.homedir();
}
