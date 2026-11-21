#!/usr/bin/env node
/**
 * Refuse a packaged Sync tree that carries a second Electron.
 *
 * `@suite/sync-app` depends on `@suite/sync-server`, the workspace package whose root is
 * `apps/sync`. electron-builder copies a dependency's whole directory, so a build output written
 * inside `apps/sync` is swept back in as an input: the app ends up shipping a nested
 * `release/linux-unpacked` with its own 224 MB `electron`. That is 571.7 MB of a 878.5 MB install.
 *
 * `directories.output` now lives in `.artifacts/sync-app`, outside the copied package, and
 * `electron-builder.yml` keeps the server's non-runtime directories out of the asar. This check is
 * the tripwire: it fails the package, before a release, if either decision is undone.
 *
 * Usage: node scripts/check-package.mjs [linux-unpacked]
 */
import { readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const APP = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = resolve(APP, "..", "..", "..");

/** One Electron (~224 MB), the window and the relay fit comfortably; two do not. */
const SIZE_BUDGET = 300 * 1024 * 1024;

const unpacked = resolve(process.argv[2] ?? join(ROOT, ".artifacts", "sync-app", "linux-unpacked"));
const outerAsar = join(unpacked, "resources", "app.asar");

const problems = [];
let bytes = 0;

function walk(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);

    if (entry.isDirectory()) {
      if (entry.name === "linux-unpacked") {
        problems.push(`nested linux-unpacked: ${relative(unpacked, path)}`);
      }
      walk(path);
      continue;
    }

    // electron-builder can materialise a workspace dependency as a symlink. Following it would
    // count files outside the bundle, which is the opposite of what this check measures.
    if (!entry.isFile()) continue;

    const size = statSync(path).size;
    bytes += size;

    if (entry.name === "electron" && size > 1024 * 1024) {
      problems.push(`second Electron binary: ${relative(unpacked, path)} (${mib(size)})`);
    }
    if (entry.name === "app.asar" && path !== outerAsar) {
      problems.push(`nested app.asar: ${relative(unpacked, path)}`);
    }
  }
}

function mib(size) {
  return `${(size / 1024 / 1024).toFixed(1)} MiB`;
}

walk(unpacked);

if (bytes > SIZE_BUDGET) {
  problems.push(`bundle is ${mib(bytes)}, over the ${mib(SIZE_BUDGET)} budget`);
}

if (problems.length > 0) {
  process.stderr.write(
    `${relative(ROOT, unpacked)} does not look like a Sync app:\n` +
      problems.map((problem) => `  - ${problem}\n`).join("") +
      "\nKeep electron-builder's output outside apps/sync and ship only the server's dist.\n",
  );
  process.exit(1);
}

process.stdout.write(`${relative(ROOT, unpacked)}: ${mib(bytes)}, one Electron, no nested build\n`);
