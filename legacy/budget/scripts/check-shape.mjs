#!/usr/bin/env node
// Mechanical shape rules that are cheaper to check than to review.
import { readdir, readFile } from "node:fs/promises";
import { basename, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const SKIP = new Set([
  "node_modules",
  ".dev",
  "dist",
  "out",
  "build",
  "coverage",
  "storybook-static",
  ".git",
  ".vite",
  "test-results",
  "playwright-report",
  "release",
]);
const SOURCE = /\.(ts|tsx|mjs|js)$/;
const MAX_LINES = 900;
const PACK_CORE = join(root, "../../packs/budget/packages/core");
const PACK_CORE_PREFIX = "packs/budget/packages/core/";
const OBSERVE_OWNER = "packages/document-runtime/src/replica.ts";
const LORO_ALLOWED = `${PACK_CORE_PREFIX}src/loro/`;
const MONEY_ALLOWED = `${PACK_CORE_PREFIX}src/money.ts`;
const FS_ALLOWED = ["src/main/", "scripts/"];

/**
 * The pack-owned core lives outside this frozen shell, but the shell's shape
 * check still owns the rule that only its `src/loro` touch Loro and only its
 * `money.ts` does float arithmetic. Give those files their repository path so
 * the rules read the same as before the move.
 */
function relOf(file) {
  const inPackCore = relative(PACK_CORE, file);
  if (!inPackCore.startsWith("..")) return `${PACK_CORE_PREFIX}${inPackCore}`;
  return relative(root, file);
}

/** @param {string} dir @returns {Promise<string[]>} */
async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (SKIP.has(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(path)));
    else if (SOURCE.test(entry.name)) files.push(path);
  }
  return files;
}

const problems = [];
const observeSites = [];
const files = [
  ...(await walk(root)),
  ...(await walk(PACK_CORE)),
  ...(await walk(join(root, "../../packs/budget/pack"))),
];

for (const file of files) {
  const rel = relOf(file);
  if (rel === "scripts/check-shape.mjs") continue;
  const text = await readFile(file, "utf8");
  const lines = text.split("\n").length;
  const isTest = /\.(test|spec)\.(ts|tsx)$/.test(rel);

  if (lines > MAX_LINES) {
    problems.push(`${rel}: ${lines} lines (limit ${MAX_LINES}); look for a seam`);
  }

  if (/\bobserve\(/.test(text) && !rel.startsWith(LORO_ALLOWED) && !isTest) {
    observeSites.push(rel);
  }

  if (/from\s+["']loro-crdt["']/.test(text) && !rel.startsWith(LORO_ALLOWED)) {
    problems.push(`${rel}: imports loro-crdt; only ${LORO_ALLOWED} may touch Loro`);
  }

  if (/nodeIntegration\s*:\s*true/.test(text)) {
    problems.push(`${rel}: nodeIntegration must stay false`);
  }

  if (!isTest && rel !== MONEY_ALLOWED) {
    if (/\bparseFloat\s*\(/.test(text) || /\.toFixed\s*\(/.test(text)) {
      problems.push(`${rel}: floats are not money; use ${MONEY_ALLOWED}`);
    }
  }

  if (
    (rel.startsWith("src/") || rel.startsWith("packages/") || rel.startsWith(PACK_CORE_PREFIX)) &&
    !isTest
  ) {
    // `net.fetch` is not a network call: it is Electron's only way to read a
    // `file:` URL, and the protocol handler that serves the renderer needs it.
    // Everything else that fetches is.
    const withoutFileReads = text.replace(/\bnet\.fetch\s*\(/gu, "net.readFileUrl(");
    if (
      /\bfetch\s*\(/.test(withoutFileReads) ||
      /\bXMLHttpRequest\b/.test(withoutFileReads) ||
      /\bWebSocket\b/.test(withoutFileReads)
    ) {
      problems.push(`${rel}: the app makes no network calls`);
    }
  }

  if (/from\s+["']node:fs(\/promises)?["']/.test(text)) {
    const allowed = isTest || FS_ALLOWED.some((prefix) => rel.startsWith(prefix));
    if (!allowed)
      problems.push(`${rel}: node:fs belongs in the main process, not the renderer or core`);
  }

  if (rel.startsWith(PACK_CORE_PREFIX) && !isTest && /\bconsole\.log\s*\(/.test(text)) {
    problems.push(`${rel}: the pure core does not log`);
  }

  const name = basename(file);
  if (file.endsWith(".tsx") && !/^[A-Z]/.test(name) && !/^(main|setup)\.tsx$/.test(name)) {
    problems.push(`${rel}: components are PascalCase.tsx`);
  }
}

if (observeSites.length > 0) {
  problems.push(
    `observe() is owned by @suite/document-runtime; also called in ${observeSites.join(", ")}`,
  );
}
const runtimeReplica = join(root, "../../packages/document-runtime/src/replica.ts");
const runtimeText = await readFile(runtimeReplica, "utf8").catch(() => "");
const ownedSites = runtimeText.match(/\.observe\(/gu)?.length ?? 0;
if (ownedSites !== 1) {
  problems.push(`expected ${OBSERVE_OWNER} to own the single observe() call site`);
}

if (problems.length > 0) {
  console.error("Shape check failed:\n");
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}

console.log(`Shape check passed across ${files.length} source files.`);
