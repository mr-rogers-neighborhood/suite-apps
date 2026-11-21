#!/usr/bin/env node
import { homedir } from "node:os";
import { join } from "node:path";
import { suiteApplicationsRoot } from "@suite/contracts";
import { CATALOGUE_APPS } from "./catalogue.js";
import { registryAt } from "./installs.js";
import { nativePackageBackend } from "./nativePackageBackend.js";
import { defaultRoots } from "./nodeFileSystem.js";
import { describeRouteRejection, routeLaunch } from "./route.js";

/**
 * The launcher, as a command.
 *
 * This is the same core the desktop shell calls: the same package backend over the
 * install roots, then one routed launch. It exists so the rules can be exercised
 * without a window, and so a headless machine or a test can answer "what would
 * Start do with this argument?".
 */

const REGISTRY_FILENAME = "installs.json";
const USAGE = `suite-start — Suite's launcher

  suite-start list                 installed apps and anything refused
  suite-start open <target>        open a file path or a suite:// link
  suite-start open --dry-run <t>   print the command instead of running it
`;

function registryPath(): string {
  return process.env.SUITE_START_REGISTRY ?? join(homedir(), ".config", "suite", REGISTRY_FILENAME);
}

function backend() {
  return nativePackageBackend({
    appsRoot: suiteApplicationsRoot(process.platform, homedir()),
    roots: defaultRoots(homedir(), process.platform),
    registry: registryAt(registryPath()),
    catalogue: CATALOGUE_APPS,
  });
}

async function main(argv: readonly string[]): Promise<number> {
  const [command, ...rest] = argv;
  if (command === undefined || command === "--help" || command === "-h") {
    process.stdout.write(USAGE);
    return 0;
  }

  const packages = backend();
  const listing = await packages.list();

  if (command === "list") {
    if (listing.packages.length === 0) process.stdout.write("No Suite apps installed.\n");
    for (const { app } of listing.packages) {
      const where =
        app.flatpak === undefined
          ? app.executable
          : `${app.executable} run ${app.flatpak.application}`;
      process.stdout.write(`${app.manifest.id}\t${app.manifest.version}\t${where}\n`);
    }
    for (const entry of listing.rejected) {
      process.stdout.write(`refused\t${entry.path}\t${entry.reason}\n`);
    }
    return 0;
  }

  if (command === "open") {
    const dryRun = rest.includes("--dry-run");
    const target = rest.find((argument) => argument !== "--dry-run");
    if (target === undefined) {
      process.stderr.write("open needs a path or a suite:// link\n");
      return 2;
    }

    const routed = routeLaunch(
      target,
      listing.packages.map((entry) => entry.app),
    );
    if (!routed.ok) {
      process.stderr.write(`${describeRouteRejection(routed.reason)}\n`);
      return 2;
    }

    const plan = {
      executable: routed.plan.app.executable,
      argv: routed.plan.argv,
      ...(routed.plan.app.flatpak === undefined ? {} : { flatpak: routed.plan.app.flatpak }),
    };
    const { command: executable, args } = packages.command(plan);
    if (dryRun) {
      process.stdout.write(`${[executable, ...args].join(" ")}\n`);
      return 0;
    }

    packages.launch(plan);
    return 0;
  }

  process.stderr.write(`unknown command: ${command}\n${USAGE}`);
  return 2;
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  },
);
