#!/usr/bin/env node
/**
 * Build, sign and verify the relay's release artifact.
 *
 *   node scripts/release.mjs                      # build into dist/release/
 *   node scripts/release.mjs --key <file>         # sign with a key instead of the env var
 *   node scripts/release.mjs --generate-key       # print a fresh key pair, then stop
 *   node scripts/release.mjs --verify <dir> --public <base64>
 *
 * Three things this deliberately does:
 *
 * - **It deploys, it does not bundle.** `pnpm deploy --prod` copies the built server and its runtime
 *   dependencies into one tree, so the artifact needs no network and no workspace on the target
 *   machine. A bundler would be a new dependency in a repository that is a separate trust boundary.
 * - **It signs the bytes of the artifact and the manifest separately.** The manifest names the
 *   tarball's hash; the tarball's hash is worthless if the manifest can be edited, so each carries
 *   its own signature.
 * - **It says what it could not check.** The manifest is validated against `@suite/contracts` when
 *   that sibling checkout is present, and the summary says so either way, rather than implying a
 *   conformance check that did not run.
 */
import { execFile } from "node:child_process";
import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign,
  verify,
} from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { tarGz } from "../apps/server/dist/tar.js";

const run = promisify(execFile);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SERVER = join(ROOT, "apps/server");
const OUT = join(ROOT, "dist/release");
const ARTIFACT_ID = "suite-sync";
const ARTIFACT_FORMAT = "suite.artifact";
const CONTRACT_VERSION = "1.0.0";

/** PKCS#8 header for a raw 32-byte Ed25519 seed. */
const ED25519_PKCS8_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");

const args = process.argv.slice(2);
const arg = (name) => {
  const index = args.indexOf(`--${name}`);
  return index === -1 ? undefined : args[index + 1];
};
const flag = (name) => args.includes(`--${name}`);

function fail(message) {
  console.error(`release: ${message}`);
  process.exit(1);
}

function keyFromSeed(base64) {
  const seed = Buffer.from(base64, "base64");
  if (seed.length !== 32) fail(`a signing key is a base64 32-byte seed, not ${seed.length} bytes`);
  return createPrivateKey({
    key: Buffer.concat([ED25519_PKCS8_PREFIX, seed]),
    format: "der",
    type: "pkcs8",
  });
}

/** The fingerprint the desktop updater already publishes: first 32 hex of sha256 over the public key. */
function fingerprintOf(publicKey) {
  const spki = publicKey.export({ type: "spki", format: "der" });
  // The last 32 bytes of an Ed25519 SPKI are the raw key.
  return createHash("sha256")
    .update(spki.subarray(spki.length - 32))
    .digest("hex")
    .slice(0, 32);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

/** The exact bytes a manifest signature covers: fixed field order, no signature. */
function canonicalManifestBytes(manifest) {
  const { signature: _signature, ...core } = manifest;
  return Buffer.from(
    JSON.stringify({
      format: core.format,
      contractVersion: core.contractVersion,
      kind: core.kind,
      id: core.id,
      name: core.name,
      version: core.version,
      files: core.files.map((file) => ({
        path: file.path,
        sha256: file.sha256,
        size: file.size,
      })),
    }),
    "utf8",
  );
}

function walk(dir) {
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isSymbolicLink()) {
      // A symlink in the tree would resolve on this machine and dangle on the target. The deploy
      // uses the hoisted linker precisely so there are none; if one appears, that assumption broke.
      throw new Error(`release: unexpected symlink in the deploy: ${path}`);
    }
    if (entry.isDirectory()) found.push(...walk(path));
    else if (entry.isFile()) found.push(path);
  }
  return found.sort();
}

async function generateKey() {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const pkcs8 = privateKey.export({ type: "pkcs8", format: "der" });
  const seed = pkcs8.subarray(pkcs8.length - 32).toString("base64");
  const raw = publicKey.export({ type: "spki", format: "der" }).subarray(-32).toString("base64");
  console.log(`seed (SUITE_SYNC_RELEASE_KEY): ${seed}`);
  console.log(`public (pin this in the installer): ${raw}`);
  console.log(`fingerprint: ${fingerprintOf(publicKey)}`);
}

async function verifyArtifact(dir, publicBase64) {
  const manifestPath = join(dir, `${ARTIFACT_ID}.artifact.json`);
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const rawPublic = Buffer.from(publicBase64, "base64");
  const publicKey = createPublicKey({
    key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), rawPublic]),
    format: "der",
    type: "spki",
  });

  const problems = [];
  for (const file of manifest.files) {
    const bytes = readFileSync(join(dir, file.path));
    if (bytes.length !== file.size)
      problems.push(`${file.path}: size ${bytes.length} != ${file.size}`);
    const digest = sha256(bytes);
    if (digest !== file.sha256) problems.push(`${file.path}: sha256 ${digest} != ${file.sha256}`);
  }
  if (fingerprintOf(publicKey) !== manifest.signature.keyFingerprint) {
    problems.push("the manifest was signed by a different key than the one given");
  }
  const manifestOk = verify(
    null,
    canonicalManifestBytes(manifest),
    publicKey,
    Buffer.from(manifest.signature.value, "base64"),
  );
  if (!manifestOk) problems.push("the manifest signature does not verify");

  const tarball = join(dir, manifest.files[0].path);
  // The `.sig` is base64 text on disk, so it has to be decoded before it is a signature. Comparing
  // the file's bytes as if they were the signature is a check that reads correctly and always fails.
  const tarballSig = Buffer.from(readFileSync(`${tarball}.sig`, "utf8").trim(), "base64");
  if (problems.length === 0) {
    const tarballOk = verify(null, readFileSync(tarball), publicKey, tarballSig);
    if (!tarballOk) problems.push("the tarball signature does not verify");
  }

  if (problems.length > 0) {
    for (const problem of problems) console.error(`  ✗ ${problem}`);
    fail(`${problems.length} problem(s) verifying ${dir}`);
  }
  console.log(
    `✓ ${ARTIFACT_ID} ${manifest.version} verifies against ${manifest.signature.keyFingerprint}`,
  );
  console.log(`  ${manifest.files.length} file(s), ${manifest.files[0].size} bytes`);
}

async function main() {
  if (flag("generate-key")) return generateKey();

  const verifyDir = arg("verify");
  if (verifyDir !== undefined) {
    const publicBase64 = arg("public") ?? process.env.SUITE_SYNC_RELEASE_PUBLIC;
    if (!publicBase64) fail("--verify needs --public <base64> or SUITE_SYNC_RELEASE_PUBLIC");
    return verifyArtifact(resolve(verifyDir), publicBase64);
  }

  const seedBase64 = process.env.SUITE_SYNC_RELEASE_KEY ?? arg("key");
  if (!seedBase64) {
    fail(
      "no signing key. Set SUITE_SYNC_RELEASE_KEY to a base64 32-byte seed and pass --key, or run\n" +
        "  node scripts/release.mjs --generate-key\n" +
        "to make a development pair. An unsigned relay release is not a release.",
    );
  }
  const privateKey = keyFromSeed(seedBase64);
  const publicKey = createPublicKey(privateKey);

  const version = JSON.parse(readFileSync(join(SERVER, "package.json"), "utf8")).version;
  const staging = join(OUT, "staging");
  rmSync(staging, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });

  // `--config.node-linker=hoisted` is not an optimisation: the default layout resolves `@suite/host`
  // through a symlink into `.pnpm`, and an archive that keeps the symlink and drops its target is a
  // relay that starts here and fails on the machine it was built for.
  await run(
    "pnpm",
    ["--config.node-linker=hoisted", "deploy", "--filter", "@suite/sync-server", "--prod", staging],
    {
      cwd: ROOT,
      stdio: "inherit",
    },
  );

  // The deployed tree carries the source and the workspace plumbing the target machine has no use
  // for. Removing them is not cosmetic: `src` would let a reader think the artifact was hand-built,
  // and the lockfiles name paths that do not exist there.
  for (const unwanted of [
    "src",
    "tsconfig.json",
    "tsconfig.build.json",
    "pnpm-lock.yaml",
    "pnpm-workspace.yaml",
    ".gitignore",
  ]) {
    rmSync(join(staging, unwanted), { recursive: true, force: true });
  }
  if (!statSync(join(staging, "dist/cli.js")).isFile()) fail("the deploy produced no dist/cli.js");

  const entries = walk(staging).map((path) => ({
    path: relative(staging, path),
    bytes: readFileSync(path),
    // The service unit runs the CLI directly, so it has to be executable without a chmod step.
    mode: relative(staging, path) === "dist/cli.js" ? 0o755 : 0o644,
  }));

  const tarballName = `${ARTIFACT_ID}-${version}.tar.gz`;
  const tarball = tarGz(entries, { root: ARTIFACT_ID });
  const tarballPath = join(OUT, tarballName);
  writeFileSync(tarballPath, tarball);
  writeFileSync(`${tarballPath}.sig`, sign(null, tarball, privateKey).toString("base64"));
  writeFileSync(`${tarballPath}.sha256`, `${sha256(tarball)}  ${tarballName}\n`);

  const core = manifestFields(version, tarball);
  const manifest = {
    ...core,
    signature: {
      algorithm: "ed25519",
      keyFingerprint: fingerprintOf(publicKey),
      value: sign(null, canonicalManifestBytes(core), privateKey).toString("base64"),
    },
  };
  writeFileSync(
    join(OUT, `${ARTIFACT_ID}.artifact.json`),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );

  const contracts = join(ROOT, "../suite-start/packages/contracts/dist/artifact.js");
  let checked = "not validated (no @suite/contracts checkout beside this one)";
  try {
    const schema = await import(pathToFileURL(contracts).href);
    const parsed = schema.parseSuiteArtifact(manifest);
    if (!parsed.ok)
      fail(`the manifest does not match suite.artifact: ${JSON.stringify(parsed.issues)}`);
    checked = "matches suite.artifact";
  } catch (error) {
    checked = `not validated (${error instanceof Error ? error.message : String(error)})`;
  }

  console.log("");
  console.log(`${ARTIFACT_ID} ${version}`);
  console.log(`  artifact  ${tarballPath} (${tarball.length} bytes)`);
  console.log(`  sha256    ${sha256(tarball)}`);
  console.log(`  signed by ${manifest.signature.keyFingerprint}`);
  console.log(`  schema    ${checked}`);
  console.log("");
  console.log("Install:");
  console.log(`  tar -xzf ${tarballName} -C /opt`);
  console.log(`  ln -sf /opt/${ARTIFACT_ID}/dist/cli.js /usr/local/bin/${ARTIFACT_ID}`);
}

function manifestFields(version, tarball) {
  return {
    format: ARTIFACT_FORMAT,
    contractVersion: CONTRACT_VERSION,
    kind: "app",
    id: ARTIFACT_ID,
    name: "Suite Sync relay",
    version,
    files: [
      { path: `${ARTIFACT_ID}-${version}.tar.gz`, sha256: sha256(tarball), size: tarball.length },
    ],
  };
}

await main();
