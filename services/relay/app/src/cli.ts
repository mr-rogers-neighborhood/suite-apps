#!/usr/bin/env node
import { homedir } from "node:os";
import { dirname } from "node:path";
import { runCli } from "@suite/sync-server/dist/cli.js";
import {
  AUTOSTART_APP_ID,
  autostartCommand,
  autostartEntryFor,
  autostartLocation,
} from "./autostart.js";

/**
 * The relay without a window.
 *
 * `flatpak run --command=suite-sync run.suite.sync serve …` reaches this file, and the
 * launcher beside it sets `ELECTRON_RUN_AS_NODE=1`: the Flatpak carries one Electron
 * runtime, so the same binary is the app's window and the CLI's Node. Everything `serve`,
 * `status` and `--version` mean is still `@suite/sync-server`'s CLI — this only adds the
 * autostart verb the tray app's checkbox also writes, which makes the file it produces
 * inspectable from the command line.
 */

/** The app root, so an autostart entry made from a checkout points at the checkout. */
function appRoot(): string {
  const script = process.argv[1];
  return script === undefined ? process.cwd() : dirname(dirname(script));
}

const argv = process.argv.slice(2);

if (argv[0] === "autostart") {
  const result = autostartCommand({
    argv: argv.slice(1),
    location: autostartLocation({
      appId: AUTOSTART_APP_ID,
      home: homedir(),
      env: process.env,
    }),
    entry: () =>
      autostartEntryFor({
        appId: AUTOSTART_APP_ID,
        name: "Suite Sync",
        comment: "Your Suite relay, running in the tray",
        env: process.env,
        execPath: process.execPath,
        appRoot: appRoot(),
      }),
  });
  if (result.stdout.length > 0) process.stdout.write(result.stdout);
  if (result.stderr.length > 0) process.stderr.write(result.stderr);
  process.exitCode = result.code;
} else {
  const result = await runCli(argv);
  if (result.stdout.length > 0) process.stdout.write(result.stdout);
  if (result.stderr.length > 0) process.stderr.write(result.stderr);
  process.exitCode = result.code;
}
