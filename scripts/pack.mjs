#!/usr/bin/env node
/**
 * Build a signed desktop Suite pack.
 *
 * A pack is a directory in development and an archive in release: `manifest.json` declares what it
 * is, every payload file is hashed into that manifest, and an Ed25519 signature covers the
 * canonical bytes. The host checks all three, so a signature made here with a key the tree does not
 * pin produces an artifact that installs nowhere. That is why this script compares the key's public
 * half with `SUITE_PACK_PUBLIC_KEY` before it signs, and refuses rather than discovering the
 * mismatch on a device.
 *
 *   node scripts/pack.mjs --dir <pack-dir> [--out <file.suitepack>] [--key <base64>]
 *                         [--contract <n>] [--min-host <n>]
 *
 * The source manifest is the development manifest: it names the id, name, version, entry,
 * capabilities and contributions, and it has no `files` or `signature`. Those are generated from
 * the directory and the signature, so a pack cannot claim a hash for content it does not carry.
 *
 * The private key follows the repository rule: it is never in the working tree. `--key` wins, then
 * `$SUITE_PACK_KEY`, then `~/.config/suite/keys/pack-key` (or wherever `SUITE_KEYS_DIR` points).
 * `pnpm keys status` says whether that key is the one this tree trusts.
 */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  digestPackFiles,
  PACK_FORMAT,
  parsePackManifest,
  sha256Hex,
  signPackManifest,
} from "@suite/pack";
import { buildPackArchive } from "@suite/pack-host";
import { KEYS, pinnedPublic, publicOf, readKey } from "./lib/keys.mjs";

const SOURCE_MANIFEST = "manifest.json";

/** A DER Ed25519 PKCS#8 key is a fixed 16-byte prefix and the 32-byte seed. */
const ED25519_PKCS8_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");
const SEED_BYTES = 32;
const PKCS8_BYTES = 48;

/**
 * A private key in PKCS#8 base64, whichever form the caller had.
 *
 * `pnpm keys generate pack` writes PKCS#8, while `generatePackKeyPair()` in `@suite/pack` — and a
 * test that uses it — hands back the bare 32-byte seed. Both rebuild the same key object here, so
 * the pin check and the signature run on one representation.
 */
function pkcs8Base64(privateKeyBase64) {
  const bytes = Buffer.from(privateKeyBase64.replace(/\s+/gu, ""), "base64");
  if (bytes.byteLength === SEED_BYTES) {
    return Buffer.concat([ED25519_PKCS8_PREFIX, bytes]).toString("base64");
  }
  if (
    bytes.byteLength === PKCS8_BYTES &&
    bytes.subarray(0, ED25519_PKCS8_PREFIX.byteLength).equals(ED25519_PKCS8_PREFIX)
  ) {
    return bytes.toString("base64");
  }
  throw new Error("The pack signing key is not an Ed25519 private key.");
}

/** The public half in the form `SUITE_PACK_PUBLIC_KEY` pins. */
function publicKeyOf(privateKeyBase64) {
  return publicOf("pack", pkcs8Base64(privateKeyBase64)).publicText;
}

/** The 32-byte seed `signPackManifest` signs with. */
function seedBase64(privateKeyBase64) {
  const bytes = Buffer.from(privateKeyBase64.replace(/\s+/gu, ""), "base64");
  if (bytes.byteLength === SEED_BYTES) return bytes.toString("base64");
  return bytes.subarray(bytes.byteLength - SEED_BYTES).toString("base64");
}

/**
 * Every regular file under `base`, keyed by slash-separated pack path.
 *
 * `skip` holds the resolved output archive and its checksum. A second build with
 * `--out` inside `--dir` must not hash the previous build into the new pack.
 *
 * The record has no prototype: a payload may legitimately be named `__proto__`, and a plain object
 * would silently change its prototype instead of keeping the file.
 */
function collectFiles(base, skip, current = base, found = Object.create(null)) {
  for (const entry of readdirSync(current, { withFileTypes: true })) {
    const full = join(current, entry.name);
    if (skip.has(resolve(full))) continue;
    const path = relative(base, full).split(sep).join("/");
    if (entry.isDirectory()) {
      collectFiles(base, skip, full, found);
    } else if (entry.isFile()) {
      if (path !== SOURCE_MANIFEST) found[path] = new Uint8Array(readFileSync(full));
    } else {
      throw new Error(`${path}: only regular files and directories belong in a pack.`);
    }
  }
  return found;
}

function positiveInteger(value, flag) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) {
    throw new Error(`${flag} needs a positive integer, not ${JSON.stringify(value)}.`);
  }
  return number;
}

function requiredString(source, field) {
  const value = source[field];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${SOURCE_MANIFEST} needs a non-empty ${field}.`);
  }
  return value;
}

/**
 * Build, sign and write one pack. No output: the CLI owns stdout and the test owns its own paths.
 *
 * `privateKeyBase64` may be PKCS#8 base64 or a bare seed. `expectedPublicKeyBase64` is the pin the
 * caller trusts; a key that disagrees is refused before the signature exists.
 */
export async function bundlePack({
  directory,
  privateKeyBase64,
  expectedPublicKeyBase64,
  contractVersion,
  minimumHostVersion,
  outPath,
}) {
  if (typeof directory !== "string" || directory.length === 0) {
    throw new Error("A source pack directory is required.");
  }
  if (typeof privateKeyBase64 !== "string" || privateKeyBase64.trim().length === 0) {
    throw new Error("A pack signing key is required.");
  }

  const source = (() => {
    try {
      return JSON.parse(readFileSync(join(directory, SOURCE_MANIFEST), "utf8"));
    } catch (error) {
      throw new Error(`${join(directory, SOURCE_MANIFEST)} is not readable JSON: ${error.message}`);
    }
  })();
  if (source === null || typeof source !== "object" || Array.isArray(source)) {
    throw new Error(`${SOURCE_MANIFEST} must be a JSON object.`);
  }

  const id = requiredString(source, "id");
  const name = requiredString(source, "name");
  const version = requiredString(source, "version");
  const entry = requiredString(source, "entry");

  const contract =
    contractVersion === undefined
      ? positiveInteger(source.contractVersion, `${SOURCE_MANIFEST} contractVersion`)
      : positiveInteger(contractVersion, "--contract");
  const minimumHost =
    minimumHostVersion === undefined
      ? source.minimumHostVersion === undefined
        ? undefined
        : positiveInteger(source.minimumHostVersion, `${SOURCE_MANIFEST} minimumHostVersion`)
      : positiveInteger(minimumHostVersion, "--min-host");

  const output = outPath ?? `${id}-${version}.suitepack`;
  const skip = new Set([resolve(output), resolve(`${output}.sha256`)]);
  const files = collectFiles(directory, skip);
  if (Object.keys(files).length === 0) {
    throw new Error(`${directory} has no payload files besides ${SOURCE_MANIFEST}.`);
  }
  if (files[entry] === undefined) {
    throw new Error(
      `The entry ${entry} is not in ${directory}. Files: ${Object.keys(files).sort().join(", ")}`,
    );
  }

  const actualPublicKey = publicKeyOf(privateKeyBase64);
  if (expectedPublicKeyBase64 === undefined) {
    throw new Error("An expected public key is required, so a pack is never signed blind.");
  }
  if (actualPublicKey.trim() !== expectedPublicKeyBase64.trim()) {
    throw new Error("The signing key does not match the expected public key.");
  }

  const core = {
    format: PACK_FORMAT,
    id,
    name,
    ...(source.description === undefined ? {} : { description: source.description }),
    version,
    entry,
    contractVersion: contract,
    ...(minimumHost === undefined ? {} : { minimumHostVersion: minimumHost }),
    capabilities: Array.isArray(source.capabilities) ? source.capabilities : [],
    ...(source.contributions === undefined ? {} : { contributions: source.contributions }),
    ...(source.widgets === undefined ? {} : { widgets: source.widgets }),
    files: await digestPackFiles(files),
  };

  const manifest = { ...core, signature: signPackManifest(core, seedBase64(privateKeyBase64)) };

  const parsed = parsePackManifest(manifest);
  if (!parsed.ok) {
    throw new Error(
      `${SOURCE_MANIFEST} would produce an invalid pack: ` +
        parsed.issues.map((issue) => `${issue.path}: ${issue.message}`).join("; "),
    );
  }

  const bytes = buildPackArchive(parsed.value, files);
  const sha256 = await sha256Hex(bytes);

  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, bytes);
  writeFileSync(`${output}.sha256`, `${sha256}  ${basename(output)}\n`);

  return { manifest: parsed.value, bytes, outPath: output, sha256 };
}

function usage() {
  return `Suite pack build

  node scripts/pack.mjs --dir <pack-dir> [--out <file.suitepack>]
                        [--key <base64>] [--contract <n>] [--min-host <n>]

  --dir       source directory: manifest.json, an HTML entry and assets
  --out       archive to write; default <id>-<version>.suitepack
  --key       Ed25519 private key, base64 PKCS#8; default $SUITE_PACK_KEY,
              then the pack key in the Suite keys directory
  --contract  override the manifest's contractVersion
  --min-host  minimum host version to record

The manifest is built from the files on disk and signed with the pack key. The
key's public half must match ${KEYS.pack.pinName} in ${KEYS.pack.pinFile};
a mismatch is refused, because a host would refuse the pack. \`pnpm keys status\`
compares them, and a clean checkout has no signing key.

The archive is written with a sibling \`.sha256\` file holding the digest and name.
`;
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

async function main(argv) {
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(usage());
    return 0;
  }

  const known = new Set(["--dir", "--out", "--key", "--contract", "--min-host"]);
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (!flag.startsWith("--")) continue;
    if (!known.has(flag)) {
      throw new Error(`Unknown option ${flag}.`);
    }
    index += 1;
  }

  const directory = argumentValue(argv, "--dir");
  if (directory === undefined) throw new Error("--dir is required.");

  const privateKeyBase64 =
    argumentValue(argv, "--key") ?? process.env[KEYS.pack.env] ?? readKey("pack");

  if (
    privateKeyBase64 === null ||
    privateKeyBase64 === undefined ||
    privateKeyBase64.trim() === ""
  ) {
    throw new Error(
      "No pack signing key. Run `pnpm keys status` to see what this machine has; " +
        `\`${KEYS.pack.generate}\` makes one. ` +
        "A pack that is not signed is not installable, by design.",
    );
  }

  const pinned = pinnedPublic("pack");
  if (pinned === null) {
    throw new Error(
      `${KEYS.pack.pinName} is missing from ${KEYS.pack.pinFile}. ` +
        "There is nothing to check the key against; run `pnpm keys status`.",
    );
  }

  let publicKeyBase64;
  try {
    publicKeyBase64 = publicKeyOf(privateKeyBase64);
  } catch (error) {
    throw new Error(`${error.message} Run \`pnpm keys status\` to inspect the signing key.`);
  }
  if (publicKeyBase64 !== pinned) {
    throw new Error(
      `The pack signing key does not match ${KEYS.pack.pinName}. ` +
        "What it signs would be refused as untrusted, so nothing was signed. " +
        "Run `pnpm keys status` to compare fingerprints.",
    );
  }

  const built = await bundlePack({
    directory,
    privateKeyBase64,
    expectedPublicKeyBase64: pinned,
    contractVersion: argumentValue(argv, "--contract"),
    minimumHostVersion: argumentValue(argv, "--min-host"),
    outPath: argumentValue(argv, "--out"),
  });

  const fileCount = built.manifest.files.length;
  const totalBytes = built.manifest.files.reduce((sum, file) => sum + file.bytes, 0);
  process.stdout.write(
    `${built.outPath}  ${fileCount} files  ${totalBytes} bytes  ` +
      `id=${built.manifest.id} v${built.manifest.version}\n`,
  );
  process.stdout.write(`${built.outPath}.sha256  ${built.sha256}\n`);
  return 0;
}

const invokedDirectly =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  try {
    process.exit(await main(process.argv.slice(2)));
  } catch (error) {
    process.stderr.write(`pack: ${error.message}\n`);
    process.exit(1);
  }
}
