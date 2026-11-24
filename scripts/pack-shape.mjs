#!/usr/bin/env node
/**
 * Enforce the packed-app shape in `apps/<app>/pack/`.
 *
 * The convention lives in docs/spec/repo-structure.md R2.2 and the authoring
 * reference it links. This script is the enforcement: it runs in the gate's
 * `scripts` row, so a pack that drifts fails CI rather than a review.
 *
 *   node scripts/pack-shape.mjs
 *   node scripts/pack-shape.mjs --check   # the same check
 *
 * What it checks, for every declared packable app:
 *
 *   1. `pack/` holds the required files and has at least one pack test.
 *   2. `manifest.json`'s version equals the app's `package.json` version.
 *   3. No generated directory (`dist/`, `node_modules/`, …) is in the tree.
 *   4. `manifest.json` names no field, value or capability the shipped schema
 *      does not define (S3.7). The field list is read from
 *      `docs/spec/manifest.schema.json`; this file does not repeat it.
 *
 * A pack is declared by its app, not inferred from a directory: `package.json`
 * carries `"suite": { "pack": true }`. The declaration is what lets the rule
 * land before the other apps are converted — an unconverted `pack/` is skipped
 * with a note, not exempted silently. The required minimum lives in the
 * constants below; an app may add files to `pack/` freely.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

/** The minimum a pack source directory holds. Extra files are allowed. */
export const REQUIRED = [
  { path: "manifest.json", kind: "file" },
  { path: "vite.config.ts", kind: "file" },
  { path: "README.md", kind: "file" },
  { path: "src", kind: "directory" },
];

/**
 * A pack test. The gate runs the app's `test:pack` script, and CI is where a
 * pack's tests become proof, so a pack with none fails here.
 */
export const PACK_TEST = /\.test\.[cm]?[jt]sx?$/u;

/**
 * Generated directories. They belong outside the committed source, in the
 * build's output directory; finding one under `pack/` means a build or an
 * install wrote into the source tree.
 */
export const GENERATED_DIRS = new Set([
  "dist",
  "node_modules",
  "build",
  "out",
  "coverage",
  ".vite",
  ".turbo",
  "storybook-static",
  "test-results",
  "playwright-report",
  "release",
]);

/**
 * Fields the pack build generates from the output directory and the signing key
 * (R2.3). A source manifest that carries one is a hand-written list or signature,
 * which is exactly what the build is supposed to own.
 */
export const GENERATED_FIELDS = ["files", "signature"];

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`${relative(process.cwd(), path)}: ${error.message}`);
  }
}

function isDirectory(path) {
  return existsSync(path) && statSync(path).isDirectory();
}

function isFile(path) {
  return existsSync(path) && statSync(path).isFile();
}

/** Resolve a local `#/$defs/...` reference against the schema document. */
function deref(schema, root) {
  let node = schema;
  while (node !== undefined && typeof node.$ref === "string") {
    node = node.$ref
      .replace(/^#\//u, "")
      .split("/")
      .reduce((current, key) => current?.[key], root);
  }
  return node;
}

/**
 * The manifest against the schema's field names, enum values and constants.
 *
 * Only the parts S3.7 needs: an unknown field or a value outside a closed
 * vocabulary is a refusal. Required fields are the build's business — the
 * source manifest is signed later, after `publisher`, `files` and `signature`
 * are generated — so their absence is not this check's failure.
 */
export function schemaProblems(schema, manifest) {
  const problems = [];

  function visit(node, value, path) {
    const resolved = deref(node, schema);
    if (resolved === undefined) {
      problems.push(`${path}: manifest.schema.json has no schema for this position`);
      return;
    }

    if (resolved.const !== undefined && value !== resolved.const) {
      problems.push(`${path}: must be ${JSON.stringify(resolved.const)}`);
    }
    if (Array.isArray(resolved.enum) && !resolved.enum.includes(value)) {
      problems.push(
        `${path}: ${JSON.stringify(value)} is not a value manifest.schema.json defines`,
      );
    }

    if (Array.isArray(value)) {
      if (resolved.items !== undefined) {
        value.forEach((item, index) => visit(resolved.items, item, `${path}[${index}]`));
      }
      return;
    }

    if (value === null || typeof value !== "object") return;

    const properties = resolved.properties ?? {};
    for (const [key, child] of Object.entries(value)) {
      const childPath = `${path}.${key}`;
      if (properties[key] !== undefined) {
        visit(properties[key], child, childPath);
      } else if (resolved.additionalProperties === false) {
        problems.push(`${childPath}: manifest.schema.json declares no such field`);
      } else if (typeof resolved.additionalProperties === "object") {
        visit(resolved.additionalProperties, child, childPath);
      }
    }
  }

  visit(schema, manifest, "manifest.json");
  return problems;
}

/** Walk a pack directory, collecting tests and rejecting generated directories. */
function walkPack(packDir, problems) {
  let tests = 0;

  function walk(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (GENERATED_DIRS.has(entry.name)) {
          problems.push(
            `${relative(ROOT, path)}: generated directory in the pack source; build to the app's output directory instead`,
          );
          continue;
        }
        walk(path);
      } else if (PACK_TEST.test(entry.name)) {
        tests += 1;
      }
    }
  }

  walk(packDir);
  return tests;
}

/**
 * Check every packable app under `root`.
 *
 * Returns `{ ok, packs, skipped, problems }`. `packs` is the apps checked and
 * `skipped` is a legacy `pack/` whose app has not declared itself yet, so a
 * run says plainly what it did not cover.
 */
export function checkPackShape({
  root = ROOT,
  schemaPath = join(root, "docs", "spec", "manifest.schema.json"),
} = {}) {
  const appsDir = join(root, "apps");
  const schema = readJson(schemaPath);
  const packs = [];
  const skipped = [];
  const problems = [];

  for (const entry of readdirSync(appsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const appDir = join(appsDir, entry.name);
    const appManifest = join(appDir, "package.json");
    if (!isFile(appManifest)) continue;

    const app = readJson(appManifest);
    const declared = app?.suite?.pack === true;
    const packDir = join(appDir, "pack");

    if (!declared) {
      if (isDirectory(packDir)) {
        skipped.push({
          app: entry.name,
          dir: relative(root, packDir),
          reason: `not declared packable; add "suite": { "pack": true } to its package.json when it becomes a pack`,
        });
      }
      continue;
    }

    if (!isDirectory(packDir)) {
      problems.push(`${relative(root, packDir)}: declared packable but has no pack directory`);
      continue;
    }

    packs.push({ app: entry.name, dir: relative(root, packDir) });

    for (const required of REQUIRED) {
      const path = join(packDir, required.path);
      const present = required.kind === "directory" ? isDirectory(path) : isFile(path);
      if (!present) {
        problems.push(
          `${relative(root, path)}: missing required pack ${required.kind === "directory" ? "directory" : "file"}`,
        );
      }
    }

    if (walkPack(packDir, problems) === 0) {
      problems.push(
        `${relative(root, packDir)}: no pack test; add at least one *.test.* and wire it into the app's test:pack script`,
      );
    }

    const manifestPath = join(packDir, "manifest.json");
    if (!isFile(manifestPath)) continue;
    const manifest = readJson(manifestPath);

    if (manifest.version !== app.version) {
      problems.push(
        `${relative(root, manifestPath)}: version ${JSON.stringify(manifest.version)} does not match the app version ${JSON.stringify(app.version)}`,
      );
    }

    for (const field of GENERATED_FIELDS) {
      if (manifest[field] !== undefined) {
        problems.push(
          `${relative(root, manifestPath)}: ${field} is generated by the pack build; the source manifest must not hand-write it`,
        );
      }
    }

    for (const problem of schemaProblems(schema, manifest)) {
      problems.push(`${relative(root, manifestPath)}: ${problem}`);
    }
  }

  packs.sort((left, right) => left.app.localeCompare(right.app));
  skipped.sort((left, right) => left.app.localeCompare(right.app));
  return { ok: problems.length === 0, packs, skipped, problems };
}

function main(argv) {
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(`Suite pack shape

  node scripts/pack-shape.mjs [--check]

Checks every app whose package.json declares "suite": { "pack": true }.
The convention is docs/spec/repo-structure.md R2.2; the authoring reference
is docs/reference/pack-authoring.md.
`);
    return 0;
  }

  const known = new Set(["--check"]);
  for (const flag of argv) {
    if (flag.startsWith("--") && !known.has(flag)) {
      process.stderr.write(`pack-shape: unknown option ${flag}\n`);
      return 2;
    }
  }

  const result = checkPackShape();
  for (const pack of result.packs) {
    process.stdout.write(`ok    ${pack.app.padEnd(10)} ${pack.dir}\n`);
  }
  for (const pack of result.skipped) {
    process.stdout.write(`skip  ${pack.app.padEnd(10)} ${pack.dir} (${pack.reason})\n`);
  }
  for (const problem of result.problems) {
    process.stderr.write(`FAIL  ${problem}\n`);
  }
  if (result.ok) {
    process.stdout.write(
      `pack shape ok: ${result.packs.length} pack${result.packs.length === 1 ? "" : "s"}\n`,
    );
  }
  return result.ok ? 0 : 1;
}

const invokedDirectly =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  try {
    process.exit(main(process.argv.slice(2)));
  } catch (error) {
    process.stderr.write(`pack-shape: ${error.message}\n`);
    process.exit(1);
  }
}
