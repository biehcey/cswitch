#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import { parseAddArgs } from "./add-args.js";
import { runAdd } from "./add.js";
import { parseBindArgs } from "./bind-args.js";
import { runBind, runBindList } from "./bind.js";
import { ConfigError, cswitchHomePath, readConfig, type Config } from "./config.js";
import { EXIT_OK, EXIT_RUNTIME, EXIT_USAGE } from "./exit-codes.js";
import { HELP_TEXT } from "./help-text.js";
import { parseTopLevel } from "./args.js";
import { resolveHome } from "./home.js";
import { createProcessIo } from "./io.js";
import { parseInitArgs } from "./init-args.js";
import { runInit } from "./init.js";
import { runInteractive } from "./interactive.js";
import { runLaunch } from "./launch.js";
import { parseRemoveArgs, REMOVE_HELP_TEXT } from "./remove-args.js";
import { runRemove } from "./remove.js";
import { parseShellInitArgs } from "./shell-init-args.js";
import { renderShellInit } from "./shell-init.js";
import { parseStatusArgs } from "./status-args.js";
import { runStatus } from "./status.js";
import { parseUnbindArgs } from "./unbind-args.js";
import { runUnbind } from "./unbind.js";
import { readVersion } from "./version.js";

async function handleInit(rest: string[]): Promise<number> {
  const parsed = parseInitArgs(rest);
  if (parsed.kind === "error") {
    process.stderr.write(`${parsed.message}\n`);
    return EXIT_USAGE;
  }

  return runInit({
    home: resolveHome(process.env),
    nameFlag: parsed.name,
    io: createProcessIo(),
    env: process.env,
  });
}

function handleAdd(rest: string[]): number {
  const parsed = parseAddArgs(rest);
  if (parsed.kind === "error") {
    process.stderr.write(`${parsed.message}\n`);
    return EXIT_USAGE;
  }

  return runAdd({ home: resolveHome(process.env), name: parsed.name, bindDir: parsed.bindDir });
}

async function handleRemove(rest: string[]): Promise<number> {
  const parsed = parseRemoveArgs(rest);
  if (parsed.kind === "help") {
    process.stdout.write(`${REMOVE_HELP_TEXT}\n`);
    return EXIT_OK;
  }
  if (parsed.kind === "error") {
    process.stderr.write(`${parsed.message}\n`);
    return EXIT_USAGE;
  }

  return runRemove({ home: resolveHome(process.env), name: parsed.name, force: parsed.force, io: createProcessIo() });
}

async function handleBind(rest: string[]): Promise<number> {
  const parsed = parseBindArgs(rest);
  if (parsed.kind === "error") {
    process.stderr.write(`${parsed.message}\n`);
    return EXIT_USAGE;
  }

  const home = resolveHome(process.env);
  if (parsed.kind === "list") {
    return runBindList({ home });
  }

  return runBind({ home, dir: parsed.dir, profileName: parsed.profile, force: parsed.force, io: createProcessIo() });
}

function handleShellInit(rest: string[]): number {
  const parsed = parseShellInitArgs(rest);
  if (parsed.kind === "error") {
    process.stderr.write(`${parsed.message}\n`);
    return EXIT_USAGE;
  }

  process.stdout.write(`${renderShellInit(parsed.shell)}\n`);
  return EXIT_OK;
}

function handleStatus(rest: string[]): number {
  const parsed = parseStatusArgs(rest);
  if (parsed.kind === "error") {
    process.stderr.write(`${parsed.message}\n`);
    return EXIT_USAGE;
  }

  return runStatus({ home: resolveHome(process.env), cwd: process.cwd(), json: parsed.json });
}

function handleUnbind(rest: string[]): number {
  const parsed = parseUnbindArgs(rest);
  if (parsed.kind === "error") {
    process.stderr.write(`${parsed.message}\n`);
    return EXIT_USAGE;
  }

  return runUnbind({ home: resolveHome(process.env), dir: parsed.dir });
}

/**
 * Interactive Mode's entry condition (spec §10.1): argument-less **and** a real
 * TTY. A non-TTY argument-less call (pipe, CI, `exec()`) falls through to
 * `parseTopLevel`'s existing empty-argv handling, which already yields the
 * help text + exit 64.
 */
function shouldEnterInteractiveMode(argv: string[]): boolean {
  return argv.length === 0 && process.stdin.isTTY === true;
}

async function handleInteractive(): Promise<number> {
  const home = resolveHome(process.env);
  return runInteractive({
    home,
    cswitchHome: cswitchHomePath(home),
    env: process.env,
    cwd: process.cwd(),
    io: createProcessIo(),
    stdin: process.stdin,
    write: (text) => process.stdout.write(text),
  });
}

export async function run(argv: string[]): Promise<number> {
  if (shouldEnterInteractiveMode(argv)) {
    return handleInteractive();
  }

  const parsed = parseTopLevel(argv);

  switch (parsed.kind) {
    case "help": {
      const stream = parsed.exitCode === EXIT_OK ? process.stdout : process.stderr;
      stream.write(`${HELP_TEXT}\n`);
      return parsed.exitCode;
    }
    case "version": {
      process.stdout.write(`${readVersion()}\n`);
      return EXIT_OK;
    }
    case "usage-error": {
      process.stderr.write(`${parsed.message}\n`);
      return EXIT_USAGE;
    }
    case "subcommand": {
      if (parsed.name === "init") {
        return handleInit(parsed.rest);
      }
      if (parsed.name === "add") {
        return handleAdd(parsed.rest);
      }
      if (parsed.name === "remove") {
        return handleRemove(parsed.rest);
      }
      if (parsed.name === "bind") {
        return handleBind(parsed.rest);
      }
      if (parsed.name === "unbind") {
        return handleUnbind(parsed.rest);
      }
      if (parsed.name === "shell-init") {
        return handleShellInit(parsed.rest);
      }
      if (parsed.name === "status") {
        return handleStatus(parsed.rest);
      }
      process.stderr.write(`cswitch ${parsed.name}: not implemented yet\n`);
      return EXIT_RUNTIME;
    }
    case "launch": {
      const home = resolveHome(process.env);
      const cswitchHome = cswitchHomePath(home);

      let config: Config | undefined;
      try {
        config = readConfig(cswitchHome);
      } catch (err) {
        process.stderr.write(`${(err as ConfigError).message}\n`);
        return EXIT_RUNTIME;
      }

      return runLaunch({
        home,
        cswitchHome,
        config,
        profileName: parsed.profile,
        quiet: parsed.quiet,
        command: parsed.command,
        env: process.env,
        cwd: process.cwd(),
      });
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err) => {
      process.stderr.write(`cswitch: unexpected error: ${(err as Error).message}\n`);
      process.exit(EXIT_RUNTIME);
    },
  );
}
