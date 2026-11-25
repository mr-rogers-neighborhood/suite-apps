#!/usr/bin/env node
/**
 * Give every split pack the app's `node_modules`.
 *
 * A pack is source, not a workspace package (repo-structure R2.2), so pnpm
 * never links dependencies under `packs/<app>/pack`. Its config and tests still
 * import React, Vitest and the app's other dev dependencies, so each pack tree
 * links the legacy shell's installed tree beside it:
 *
 *   packs/<app>/node_modules -> ../../legacy/<app>/node_modules
 *
 * The link sits beside `pack/`, never inside it, so the pack source stays
 * package-free and `scripts/pack-shape.mjs` still sees only source. Run from
 * `prepare` after `pnpm install`; the link also makes node resolution work for
 * Vite, Vitest and TypeScript without a second dependency graph.
 *
 * Usage:
 *   node scripts/pack-links.mjs
 */
import { existsSync, lstatSync, mkdirSync, rmSync, symlinkSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

/** The apps whose pack source moved out of the app tree. */
export const PACK_APPS = ["canvas", "planner", "budget", "help"];

function remove(path) {
  try {
    lstatSync(path);
  } catch {
    return;
  }
  rmSync(path, { recursive: true, force: true });
}

export function linkPacks(root = ROOT) {
  const linked = [];
  for (const app of PACK_APPS) {
    const target = join(root, "legacy", app, "node_modules");
    const link = join(root, "packs", app, "node_modules");
    if (!existsSync(target)) continue;
    mkdirSync(dirname(link), { recursive: true });
    remove(link);
    // A junction is the Windows form that needs no elevated privilege. Both
    // forms point at the shell's installed tree, never a copy.
    symlinkSync(
      process.platform === "win32" ? target : relative(dirname(link), target),
      link,
      process.platform === "win32" ? "junction" : "dir",
    );
    linked.push(relative(root, link));
  }
  return linked;
}

const invokedDirectly =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) linkPacks();
