#!/usr/bin/env node
/**
 * Build Budget's renderer as a signed desktop pack.
 *
 *   pnpm budget:pack [--key <base64>] [--out <file.suitepack>] [--version <semver>]
 *
 * `apps/budget/pack/vite.config.ts` builds the renderer and the prelude into
 * `apps/budget/.dev/pack`, which is the pack's build output, not its source.
 * This script writes the generated manifest there, puts the prelude script in
 * front of the app script, and hands the directory to `bundlePack`.
 *
 * The signing key follows the repository rule: it is never in the working tree.
 * `--key` wins, then `$SUITE_PACK_KEY`, then `~/.config/suite/keys/pack-key`.
 * The public half must equal `SUITE_PACK_PUBLIC_KEY`, so this build refuses a
 * key the host would refuse; `pnpm keys status` compares them for a person.
 */
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { KEYS, pinnedPublic, readKey } from "./lib/keys.mjs";
import { writePackCard } from "./lib/packCard.mjs";
import { bundlePack, platformsSummary, publicKeyOfSigningKey } from "./pack.mjs";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const PACK_DIR = join(ROOT, "apps", "budget", "pack");
const APP_DIR = join(ROOT, "apps", "budget");
const DIST = join(APP_DIR, ".dev", "pack");
const SOURCE_MANIFEST = join(PACK_DIR, "manifest.json");

/**
 * Refuse a signing key the tree does not pin.
 *
 * The same check `bundlePack` makes, run before the expensive build and with a
 * sentence about the pin rather than about the two keys' bytes. The production
 * build always calls this; the gate's round-trip test passes its own ephemeral
 * public half to `bundlePack` instead.
 */
export function requirePinnedSigningKey(privateKeyBase64, pinnedPublicKeyBase64) {
  if (
    typeof pinnedPublicKeyBase64 !== "string" ||
    pinnedPublicKeyBase64.trim().length === 0
  ) {
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

/**
 * Put the prelude before the app in Vite's generated page.
 *
 * Vite owns the hashed script name and the stylesheet; this only inserts one
 * module script ahead of the app's. The CSP is required: the installer refuses a
 * pack that does not seal its own network.
 */
export function injectPrelude(html) {
  if (html.includes('src="./prelude.js"')) return html;

  if (!/<meta\b[^>]*http-equiv="Content-Security-Policy"/iu.test(html)) {
    throw new Error("The pack entry has no Content-Security-Policy meta tag.");
  }
  if (!/default-src\s+'self'/u.test(html) || !/connect-src\s+'self'/u.test(html)) {
    throw new Error("The pack entry's CSP must name default-src 'self' and connect-src 'self'.");
  }

  const script = /<script\b(?=[^>]*\btype="module")[^>]*><\/script>/iu.exec(html);
  if (script === null) {
    throw new Error("The pack entry has no module script; the app would never start.");
  }

  return `${html.slice(0, script.index)}<script type="module" src="./prelude.js"></script>\n    ${html.slice(script.index)}`;
}

/** The generated manifest: the source manifest with this build's version. */
export function manifestFor(source, version) {
  return { ...source, version: version ?? source.version };
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
  return `Suite Budget pack

  pnpm budget:pack [--key <base64>] [--out <file.suitepack>] [--version <semver>]
                   [--contract <n>] [--min-host <n>]

  --key       Ed25519 private key, base64 PKCS#8 or a bare seed; default
              $${KEYS.pack.env}, then the pack key in the Suite keys directory
  --out       archive to write; default apps/budget/.dev/budget-<version>.suitepack
  --version   pack version to record; default the version in manifest.json
  --contract  override the manifest's contractVersion
  --min-host  minimum host version to record

Builds the renderer and prelude into apps/budget/.dev/pack, then signs the
directory with the pinned pack key. A key whose public half is not
${KEYS.pack.pinName} is refused before anything is signed.
`;
}

async function main(argv) {
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(usage());
    return 0;
  }

  const known = new Set(["--key", "--out", "--version", "--contract", "--min-host"]);
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (!flag.startsWith("--")) continue;
    if (!known.has(flag)) throw new Error(`Unknown option ${flag}.`);
    index += 1;
  }

  const source = JSON.parse(readFileSync(SOURCE_MANIFEST, "utf8"));
  const manifest = manifestFor(source, argumentValue(argv, "--version"));
  const out =
    argumentValue(argv, "--out") ?? join(APP_DIR, ".dev", `budget-${manifest.version}.suitepack`);

  const key = argumentValue(argv, "--key") ?? process.env[KEYS.pack.env] ?? readKey("pack");
  if (key === null || key === undefined || key.trim() === "") {
    throw new Error(
      "No pack signing key. Run `pnpm keys status` to see what this machine has; " +
        `\`${KEYS.pack.generate}\` makes one. A pack that is not signed is not installable, by design.`,
    );
  }

  const pinned = pinnedPublic("pack");
  const publicKey = requirePinnedSigningKey(key, pinned);

  // The renderer resolves shared packages through their published `dist`, as the
  // monorepo gate does. Build them first so `pnpm budget:pack` works on a clean
  // checkout, not only after some other build has run.
  await run(
    "pnpm",
    [
      "--filter",
      "./packages/*",
      "--filter",
      "./apps/*/packages/*",
      "--workspace-concurrency=2",
      "run",
      "build",
    ],
    ROOT,
  );
  await run(
    "pnpm",
    ["--dir", APP_DIR, "exec", "vite", "build", "--config", "pack/vite.config.ts"],
    ROOT,
  );

  // `bundlePack` reads the development manifest from the directory and excludes
  // it from the payload, so the built copy carries only this build's version.
  writeFileSync(join(DIST, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  const built = injectPrelude(readFileSync(join(DIST, "index.html"), "utf8"));
  writeFileSync(join(DIST, "index.html"), built);

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
    process.stderr.write(`budget-pack: ${error.message}\n`);
    process.exit(1);
  }
}
