#!/usr/bin/env node
/**
 * Release the relay from the monorepo.
 *
 * The relay used to carry its own packaging script while it was a standalone
 * repository. In this workspace the gate, the changelog and the update key live
 * at the root, so the release has one home: `scripts/release.mjs sync`.
 *
 * This wrapper keeps the package-level command working without a second,
 * drifting copy of the build.
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const rootRelease = fileURLToPath(new URL("../../../scripts/release.mjs", import.meta.url));
const result = spawnSync(process.execPath, [rootRelease, "sync", ...process.argv.slice(2)], {
  stdio: "inherit",
  env: process.env,
});

process.exit(result.status ?? 1);
