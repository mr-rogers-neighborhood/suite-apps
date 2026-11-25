#!/usr/bin/env node
/**
 * Build Help's renderer and handbook as a signed desktop pack.
 *
 *   pnpm help:pack [--key <base64>] [--out <file.suitepack>] [--version <semver>]
 *   pnpm help:pack --check-repro
 *
 * `packs/help/pack/vite.config.ts` builds Help's renderer, the compiled handbook pages and the
 * generated `public/data` index into `packs/help/.dev/pack`, which is the pack's build output, not
 * its source. This script runs Help's generators first, writes the generated manifest there and
 * hands the directory to `bundlePack`.
 *
 * `--check-repro` is the issue's reproducibility proof: it runs the same build twice into two
 * generated directories and compares every payload path and SHA-256. It needs no signing key,
 * because it compares the bytes the signer would hash, not the signature.
 *
 * The signing key follows the repository rule: it is never in the working tree. `--key` wins, then
 * `$SUITE_PACK_KEY`, then `~/.config/suite/keys/pack-key`. The public half must equal
 * `SUITE_PACK_PUBLIC_KEY`, so this build refuses a key the host would refuse; `pnpm keys status`
 * compares them for a person.
 */
import { spawn } from "node:child_process";
import { readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { digestPackFiles, sha256Hex } from "@suite/pack";
import { KEYS, pinnedPublic, readKey } from "./lib/keys.mjs";
import { writePackCard } from "./lib/packCard.mjs";
import { bundlePack, platformsSummary, publicKeyOfSigningKey } from "./pack.mjs";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const PACK_ROOT = join(ROOT, "packs", "help");
const PACK_DIR = join(PACK_ROOT, "pack");
const DIST = join(PACK_ROOT, ".dev", "pack");
const SOURCE_MANIFEST = join(PACK_DIR, "manifest.json");

/**
 * Refuse a signing key the tree does not pin.
 *
 * The same check `bundlePack` makes, run before the expensive build and with a sentence about the
 * pin rather than about the two keys' bytes. The production build always calls this; the
 * reproducibility check passes no key at all.
 */
export function requirePinnedSigningKey(privateKeyBase64, pinnedPublicKeyBase64) {
  if (typeof pinnedPublicKeyBase64 !== "string" || pinnedPublicKeyBase64.trim().length === 0) {
    throw new Error(
      `${KEYS.pack.pinName} is missing from ${KEYS.pack.pinFile}; there is nothing to check the key against.`,
    );
  }
  const actual = publicKeyOfSigningKey(privateKeyBase64);
  if (actual !== pinnedPublicKeyBase64.trim()) {
    throw new Error(
      `The pack signing key does not match ${KEYS.pack.pinName}. ` +
        "What it signs would be refused as untrusted, so nothing was signed. " +
        "Run `pnpm keys status` to compare fingerprints.",
    );
  }
  return actual;
}

/** The generated manifest: the source manifest with this build's version. */
export function manifestFor(source, version) {
  return { ...source, version: version ?? source.version };
}

/** A built entry that a pack host will load. */
export function checkEntry(html) {
  if (!/<meta\b[^>]*http-equiv="Content-Security-Policy"/iu.test(html)) {
    throw new Error("The built pack entry has no Content-Security-Policy meta tag.");
  }
  if (!/default-src\s+'self'/u.test(html) || !/connect-src\s+'self'/u.test(html)) {
    throw new Error("The built pack entry's CSP must name default-src 'self' and connect-src 'self'.");
  }
  if (!/<script\b(?=[^>]*\btype="module")[^>]*\bsrc="[^"]+"/iu.test(html)) {
    throw new Error("The built pack entry has no module script; the app would never start.");
  }
  return html;
}

/** Every regular file under `base`, keyed by slash-separated pack path. */
export function collectPayload(base, current = base, found = Object.create(null)) {
  for (const entry of readdirSync(current, { withFileTypes: true })) {
    const full = join(current, entry.name);
    const path = relative(base, full).split(sep).join("/");
    if (entry.isDirectory()) {
      collectPayload(base, full, found);
    } else if (entry.isFile()) {
      found[path] = new Uint8Array(readFileSync(full));
    } else {
      throw new Error(`${path}: only regular files and directories belong in a pack.`);
    }
  }
  return found;
}

/**
 * The generated corpus the archive must carry.
 *
 * Help's payload is not only a renderer: the explorer fetches these files at run time and the
 * handbook pages are compiled into the assets. A build that lost them would still produce an HTML
 * page and a valid manifest, so the paths are checked before the manifest hashes them.
 */
const REQUIRED_CORPUS = [
  "data/tree.json",
  "data/modules.json",
  "data/search.json",
  "data/tours.json",
  "data/tour-membership.json",
  "data/handbook-search.json",
  "data/docs.json",
];

export function checkPayload(files) {
  for (const path of REQUIRED_CORPUS) {
    if (files[path] === undefined) {
      throw new Error(`The built pack is missing ${path}; run the Help index before building.`);
    }
  }
  if (
    !Object.keys(files).some(
      (path) => /^data\/modules\/.+\.json$/u.test(path) && files[path] !== undefined,
    )
  ) {
    throw new Error("The built pack has no per-module data files; the Modules view would be empty.");
  }
  if (
    !Object.keys(files).some(
      (path) => /^assets\/.+\.js$/u.test(path) && files[path] !== undefined,
    )
  ) {
    throw new Error("The built pack has no compiled assets; the handbook pages did not bundle.");
  }
  return files;
}

/**
 * Compare two digest lists from `digestPackFiles`.
 *
 * Returns the paths only one build has and the paths whose hash or length differs. `same` is the
 * answer the `--check-repro` command exits with.
 */
export function comparePayloads(left, right) {
  const before = new Map(left.map((file) => [file.path, `${file.sha256}:${file.bytes}`]));
  const after = new Map(right.map((file) => [file.path, `${file.sha256}:${file.bytes}`]));
  const onlyLeft = [...before.keys()].filter((path) => !after.has(path)).sort();
  const onlyRight = [...after.keys()].filter((path) => !before.has(path)).sort();
  const differing = [...before.keys()]
    .filter((path) => after.has(path) && before.get(path) !== after.get(path))
    .sort();
  return {
    same: onlyLeft.length === 0 && onlyRight.length === 0 && differing.length === 0,
    onlyLeft,
    onlyRight,
    differing,
  };
}

function run(command, args, cwd) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, { cwd, env: process.env, stdio: "inherit" });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolveRun();
      else reject(new Error(`${command} ${args.join(" ")} exited with ${code}`));
    });
  });
}

/** Regenerate the explorer data and the handbook pages the pack carries. */
export async function generateContent() {
  await run("node", [join(PACK_ROOT, "scripts", "index-code.mjs")], ROOT);
  await run("node", [join(PACK_ROOT, "scripts", "sync-docs.mjs")], ROOT);
}

/** Build the pack's payload into `outDir`, with a cache of its own. */
export async function buildPayload(outDir, cacheDir) {
  rmSync(cacheDir, { recursive: true, force: true });
  await run(
    "pnpm",
    [
      "--dir",
      PACK_ROOT,
      "exec",
      "vite",
      "build",
      "--config",
      "pack/vite.config.ts",
      "--outDir",
      outDir,
      "--emptyOutDir",
    ],
    ROOT,
  );
  return digestPackFiles(checkPayload(collectPayload(outDir)));
}

async function buildTwice() {
  const first = await buildPayload(
    join(PACK_ROOT, ".dev", "repro-a"),
    join(PACK_ROOT, ".dev", "repro-cache-a"),
  );
  const second = await buildPayload(
    join(PACK_ROOT, ".dev", "repro-b"),
    join(PACK_ROOT, ".dev", "repro-cache-b"),
  );
  const comparison = comparePayloads(first, second);
  return { first, second, comparison };
}

function argumentValue(argv, flag) {
  const index = argv.indexOf(flag);
  if (index === -1) return undefined;
  const value = argv[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`${flag} needs a value.`);
  }
  return value;
}

function usage() {
  return `Suite Help pack

  pnpm help:pack [--key <base64>] [--out <file.suitepack>] [--version <semver>]
                 [--contract <n>] [--min-host <n>]
  pnpm help:pack --check-repro

  --key          Ed25519 private key, base64 PKCS#8 or a bare seed; default
                 $${KEYS.pack.env}, then the pack key in the Suite keys directory
  --out          archive to write; default packs/help/.dev/help-<version>.suitepack
  --version      pack version to record; default the version in manifest.json
  --contract     override the manifest's contractVersion
  --min-host     minimum host version to record
  --check-repro  build twice into generated directories and compare every
                 payload path and SHA-256; needs no signing key

Builds the explorer index, the handbook pages and the renderer into
packs/help/.dev/pack, then signs the directory with the pinned pack key. A key
whose public half is not ${KEYS.pack.pinName} is refused before anything is
signed.
`;
}

async function main(argv) {
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(usage());
    return 0;
  }

  const known = new Set([
    "--key",
    "--out",
    "--version",
    "--contract",
    "--min-host",
    "--check-repro",
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (!flag.startsWith("--")) continue;
    if (!known.has(flag)) throw new Error(`Unknown option ${flag}.`);
    index += 1;
  }

  if (argv.includes("--check-repro")) {
    await generateContent();
    const { first, second, comparison } = await buildTwice();
    const digest = await sha256Hex(
      new TextEncoder().encode(JSON.stringify(first)),
    );
    if (!comparison.same) {
      process.stderr.write(
        `help-pack: two builds of this tree differ\n` +
          `  only first:  ${comparison.onlyLeft.join(", ") || "(none)"}\n` +
          `  only second: ${comparison.onlyRight.join(", ") || "(none)"}\n` +
          `  changed:     ${comparison.differing.join(", ") || "(none)"}\n`,
      );
      return 1;
    }
    process.stdout.write(
      `reproducible  ${first.length} files  ${digest}  two builds of this tree hashed the same\n`,
    );
    return 0;
  }

  const source = JSON.parse(readFileSync(SOURCE_MANIFEST, "utf8"));
  const manifest = manifestFor(source, argumentValue(argv, "--version"));
  const out =
    argumentValue(argv, "--out") ?? join(PACK_ROOT, ".dev", `help-${manifest.version}.suitepack`);

  const key = argumentValue(argv, "--key") ?? process.env[KEYS.pack.env] ?? readKey("pack");
  if (key === null || key === undefined || key.trim() === "") {
    throw new Error(
      "No pack signing key. Run `pnpm keys status` to see what this machine has; " +
        `\`${KEYS.pack.generate}\` makes one. A pack that is not signed is not installable, by design.`,
    );
  }

  const pinned = pinnedPublic("pack");
  const publicKey = requirePinnedSigningKey(key, pinned);

  // The renderer resolves shared packages through their published `dist`, as the monorepo gate
  // does. Build them first so `pnpm help:pack` works on a clean checkout, not only after some other
  // build has run.
  await run(
    "pnpm",
    [
      "--filter",
      "./packages/*",
      "--filter",
      "./legacy/*/packages/*",
      "--workspace-concurrency=2",
      "run",
      "build",
    ],
    ROOT,
  );
  await generateContent();
  await run(
    "pnpm",
    ["--dir", PACK_ROOT, "exec", "vite", "build", "--config", "pack/vite.config.ts"],
    ROOT,
  );

  // `bundlePack` reads the development manifest from the directory and excludes it from the
  // payload, so the built copy carries only this build's version.
  checkPayload(collectPayload(DIST));
  writeFileSync(join(DIST, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  checkEntry(readFileSync(join(DIST, "index.html"), "utf8"));

  const result = await bundlePack({
    directory: DIST,
    privateKeyBase64: key,
    expectedPublicKeyBase64: publicKey,
    contractVersion: argumentValue(argv, "--contract"),
    minimumHostVersion: argumentValue(argv, "--min-host"),
    outPath: out,
  });

  const card = writePackCard({ archivePath: result.outPath, manifest: result.manifest });

  const totalBytes = result.manifest.files.reduce((sum, file) => sum + file.bytes, 0);
  process.stdout.write(
    `${result.outPath}  ${result.manifest.files.length} files  ${totalBytes} bytes  ` +
      `id=${result.manifest.id} v${result.manifest.version}\n`,
  );
  process.stdout.write(`${result.outPath}.sha256  ${result.sha256}\n`);
  process.stdout.write(`packs for: ${platformsSummary(result.manifest)}\n`);
  process.stdout.write(`${card.path}  shelf ${card.card.shelf}\n`);
  return 0;
}

const invokedDirectly =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  try {
    process.exit(await main(process.argv.slice(2)));
  } catch (error) {
    process.stderr.write(`help-pack: ${error.message}\n`);
    process.exit(1);
  }
}
