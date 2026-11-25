#!/usr/bin/env node
/**
 * Build a signed catalogue index from built `.suitepack` archives (S12.2).
 *
 * The publisher does not hand-write the index: it is a function of the artifacts
 * the pack build already produced. Each archive is read, its manifest signature
 * and every file hash are verified, and the entry is copied from that manifest.
 * The archive's own SHA-256 and byte length are what the host compares before it
 * installs the download.
 *
 *   node scripts/pack-index.mjs --out <index.json> --url-base <https://…>
 *                               --sequence <n> --expires <ISO timestamp>
 *                               [--previous <sha256>] [--threshold <n>]
 *                               [--generated-at <ISO timestamp>]
 *                               [--key <base64>]… <file.suitepack>…
 *
 * `--key` is an operator signing key, repeatable. It never falls back to the
 * pack publisher key: an index and a pack are separate trust roots. The same
 * secret may be PKCS#8 (base64 or PEM) or a bare 32-byte Ed25519 seed.
 *
 * `--url-base` is the stable URL directory the archives are published under;
 * the entry URL is the archive's filename joined to it. Publishing the file
 * itself is a later seam; this script proves the file verifies.
 *
 * `--previous` is the digest `packIndexDigest` produced for the index being
 * replaced. Sequence 1 omits it; every later index must name one.
 */
import { createPrivateKey } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  canonicalPackIndexBytes,
  comparePackIndexEntries,
  isSafeArchiveUrl,
  PACK_INDEX_FORMAT,
  PACK_INDEX_VERSION,
  packIndexDigest,
  packMinimumHost,
  packRing,
  parsePackIndex,
  parsePackManifestJson,
  publisherKeyDigest,
  sha256Hex,
  signPackIndex,
  verifyPackFiles,
  verifyPackSignature,
} from "@suite/pack";
import { readPackArchive } from "@suite/pack-host";

/** A DER Ed25519 PKCS#8 key is a fixed 16-byte prefix and the 32-byte seed. */
const ED25519_PKCS8_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");

function positiveInteger(value, label) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) {
    throw new Error(`${label} needs a positive integer, not ${JSON.stringify(value)}.`);
  }
  return number;
}

function timestamp(value, label) {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
    throw new Error(`${label} needs an ISO 8601 timestamp, not ${JSON.stringify(value)}.`);
  }
  return value;
}

/** The 32-byte seed `signPackIndex` signs with, from PKCS#8 or a bare seed. */
export function seedBase64(text) {
  const trimmed = text.trim();
  let der;
  if (trimmed.includes("-----BEGIN")) {
    der = Buffer.from(createPrivateKey(trimmed).export({ format: "der", type: "pkcs8" }));
  } else {
    der = Buffer.from(trimmed.replace(/\s+/gu, ""), "base64");
  }
  if (der.byteLength === 32) return der.toString("base64");
  if (
    der.byteLength === ED25519_PKCS8_PREFIX.byteLength + 32 &&
    der.subarray(0, ED25519_PKCS8_PREFIX.byteLength).equals(ED25519_PKCS8_PREFIX)
  ) {
    return der.subarray(der.byteLength - 32).toString("base64");
  }
  throw new Error("An operator key is an Ed25519 PKCS#8 key or a 32-byte base64 seed.");
}

/** The entry for one built archive, after its manifest and every file hash verify. */
async function entryFor(path, urlBase) {
  const bytes = new Uint8Array(readFileSync(path));
  const archive = await readPackArchive(bytes);
  const parsed = parsePackManifestJson(new TextDecoder().decode(archive.manifestBytes));
  if (!parsed.ok) {
    throw new Error(
      `${path}: ${parsed.issues.map((issue) => `${issue.path}: ${issue.message}`).join("; ")}`,
    );
  }
  const manifest = parsed.value;
  if (manifest.publisher === undefined || manifest.publisher.key.trim().length === 0) {
    throw new Error(`${path}: the manifest names no publisher key, so the index cannot name one.`);
  }
  if (!(await verifyPackSignature(manifest, manifest.publisher.key))) {
    throw new Error(`${path}: the manifest signature does not verify against its publisher key.`);
  }
  const mismatches = await verifyPackFiles(manifest, async (file) =>
    archive.files.get(file) ?? null,
  );
  if (mismatches.length > 0) {
    const first = mismatches[0];
    throw new Error(`${path}: ${first.path} ${first.reason}; the archive and its manifest disagree.`);
  }

  const url = new URL(basename(path), urlBase.endsWith("/") ? urlBase : `${urlBase}/`).toString();
  if (!isSafeArchiveUrl(url)) {
    throw new Error(`${urlBase} does not produce a safe HTTPS archive URL for ${basename(path)}.`);
  }

  const minHost = packMinimumHost(manifest);
  const entry = {
    id: manifest.id,
    name: manifest.name,
    publisher: manifest.publisher.id ?? (await publisherKeyDigest(manifest.publisher.key)),
    version: manifest.version,
    // The effective ring and floor, not the spelling the manifest happened to use
    // (S12.9): an absent ring is `stable`, and both spellings name the same floor.
    ring: packRing(manifest),
    contractVersion: manifest.contractVersion,
    ...(minHost === undefined ? {} : { minHost }),
    ...(manifest.description === undefined ? {} : { description: manifest.description }),
    capabilities: manifest.capabilities,
    ...(manifest.platforms === undefined ? {} : { platforms: manifest.platforms }),
    archive: {
      url,
      size: bytes.byteLength,
      sha256: await sha256Hex(bytes),
    },
    signature: manifest.signature,
  };
  return entry;
}

/**
 * Build, sign and validate an index. No output: the CLI owns stdout and a test
 * owns its paths.
 */
export async function buildPackIndex({
  archives,
  urlBase,
  sequence,
  generatedAt,
  expires,
  previous,
  threshold,
  privateKeys,
  outPath,
}) {
  if (!Array.isArray(archives) || archives.length === 0) {
    throw new Error("At least one built .suitepack archive is required.");
  }
  if (typeof urlBase !== "string" || urlBase.length === 0) {
    throw new Error("A --url-base is required, so the index carries a stable archive URL.");
  }
  if (!Array.isArray(privateKeys) || privateKeys.length === 0) {
    throw new Error("At least one operator signing key is required.");
  }

  const entries = [];
  for (const archive of archives) {
    entries.push(await entryFor(archive, urlBase));
  }
  entries.sort(comparePackIndexEntries);

  const core = {
    format: PACK_INDEX_FORMAT,
    version: PACK_INDEX_VERSION,
    sequence: positiveInteger(sequence, "--sequence"),
    generatedAt: timestamp(generatedAt, "--generated-at"),
    ...(previous === undefined || previous === null || previous === ""
      ? {}
      : { previous }),
    expires: timestamp(expires, "--expires"),
    threshold:
      threshold === undefined ? privateKeys.length : positiveInteger(threshold, "--threshold"),
    entries,
  };

  const signed = signPackIndex(core, privateKeys.map(seedBase64));
  const parsed = parsePackIndex(signed);
  if (!parsed.ok) {
    throw new Error(
      `The index would be invalid: ${parsed.issues
        .map((issue) => `${issue.path}: ${issue.message}`)
        .join("; ")}`,
    );
  }

  const json = `${JSON.stringify(signed, null, 2)}\n`;
  if (outPath !== undefined) {
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, json);
  }

  return {
    index: signed,
    json,
    digest: await packIndexDigest(signed),
    canonicalBytes: canonicalPackIndexBytes(signed),
  };
}

function usage() {
  return `Suite catalogue index build

  node scripts/pack-index.mjs --out <index.json> --url-base <https://…>
                              --sequence <n> --expires <ISO timestamp>
                              [--previous <sha256>] [--threshold <n>]
                              [--generated-at <ISO timestamp>]
                              [--key <base64>]… <file.suitepack>…

  --out           index file to write; default index.json
  --url-base      HTTPS directory the .suitepack archives are published under
  --sequence      catalogue generation; it must increase on every publish
  --expires       after this instant a host refuses the index
  --previous      digest of the index this one replaces; required after sequence 1
  --threshold     operator signatures required; default: one per --key
  --generated-at  build time; default: now
  --key           operator signing key, repeatable; default $SUITE_INDEX_KEY

Each archive's manifest signature and every file hash are verified before the
entry is written. The index is signed by operator keys only: a pack publisher
key is a different trust root and is never used here.
`;
}

function valuesOf(argv, flag) {
  const values = [];
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === flag) {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new Error(`${flag} needs a value.`);
      }
      values.push(value);
      index += 1;
    }
  }
  return values;
}

function argumentValue(argv, flag) {
  return valuesOf(argv, flag)[0];
}

export async function main(argv) {
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(usage());
    return 0;
  }

  const known = new Set([
    "--out",
    "--url-base",
    "--sequence",
    "--expires",
    "--previous",
    "--threshold",
    "--generated-at",
    "--key",
  ]);
  const archives = [];
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token.startsWith("--")) {
      if (!known.has(token)) throw new Error(`Unknown option ${token}.`);
      index += 1;
      continue;
    }
    archives.push(token);
  }

  const urlBase = argumentValue(argv, "--url-base");
  if (urlBase === undefined) throw new Error("--url-base is required.");
  const sequence = argumentValue(argv, "--sequence");
  if (sequence === undefined) throw new Error("--sequence is required.");
  const expires = argumentValue(argv, "--expires");
  if (expires === undefined) throw new Error("--expires is required.");

  const fromEnvironment = (process.env.SUITE_INDEX_KEY ?? "")
    .split(/[\s,]+/u)
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  const keys = [...valuesOf(argv, "--key"), ...fromEnvironment];
  if (keys.length === 0) {
    throw new Error(
      "No operator signing key. Pass --key or set SUITE_INDEX_KEY. " +
        "An index is signed by an operator key, never by a pack publisher key.",
    );
  }

  const outPath = resolve(argumentValue(argv, "--out") ?? "index.json");
  const built = await buildPackIndex({
    archives,
    urlBase,
    sequence,
    generatedAt: argumentValue(argv, "--generated-at") ?? new Date().toISOString(),
    expires,
    previous: argumentValue(argv, "--previous"),
    threshold: argumentValue(argv, "--threshold"),
    privateKeys: keys,
    outPath,
  });

  process.stdout.write(
    `${outPath}  sequence ${built.index.sequence}  ${built.index.entries.length} pack(s)  ` +
      `threshold ${built.index.threshold}\n`,
  );
  process.stdout.write(`digest ${built.digest}\n`);
  return 0;
}

const invokedDirectly =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  try {
    process.exit(await main(process.argv.slice(2)));
  } catch (error) {
    process.stderr.write(`pack-index: ${error.message}\n`);
    process.exit(1);
  }
}
