/**
 * Where the signing keys live, and whether the one in hand is the one the apps trust.
 *
 * A public key is public, so it is pinned in the source that uses it. The private half never is,
 * which leaves one question a build cannot answer on its own: is the key on this machine the key
 * this tree pins? Signing with the wrong one fails on a device — a pack is refused as `untrusted`,
 * an update feed as `not signed by the publisher` — and by then the artifact has been built and
 * uploaded. This module answers the question locally, before anything is signed.
 *
 * The keys live outside the repository on purpose:
 *
 *   ~/.config/suite/keys/pack-key       Ed25519, base64 PKCS#8, one line
 *   ~/.config/suite/keys/update-key.pem Ed25519, PKCS#8 PEM
 *
 * `SUITE_KEYS_DIR` moves the directory. The earlier home for the pack key was `apps/go/.dev/`,
 * which is a scratch directory the build replaces, so a cleanup took the only copy with it. Nothing
 * durable belongs there, and `inspectKey` never looks there.
 *
 * This file is imported by `scripts/keys.mjs`, `scripts/release.mjs`, and two of Suite Go's
 * scripts. It has no side effects: importing it reads nothing.
 */
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync } from "node:crypto";
import {
  chmodSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** The repository root, from this file's place in it. */
export const ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));

/** The variable that moves the whole directory. */
export const KEYS_DIR_VARIABLE = "SUITE_KEYS_DIR";

/**
 * The two keys, and every fact about them that more than one script needs.
 *
 * `pin` names the file and the constant that carry the public half, in the syntax that file
 * actually uses, so reading it needs no parser per key. `pinKind` says how to rebuild the public
 * half from a private key in `publicOf`.
 */
export const KEYS = {
  pack: {
    file: "pack-key",
    label: "pack signing",
    algorithm: "Ed25519",
    encoding: "base64 PKCS#8, one line",
    env: "SUITE_PACK_KEY",
    pinFile: "apps/go/src/host/packs.ts",
    pinName: "PACK_PUBLIC_KEY",
    pinKind: "base64-raw",
    generate: "pnpm keys generate pack",
    reader: "pnpm planner:pack",
  },
  update: {
    file: "update-key.pem",
    label: "update signing",
    algorithm: "Ed25519",
    encoding: "PKCS#8 PEM",
    env: "SUITE_UPDATE_KEY",
    pinFile: "packages/desktop/src/updateSignature.ts",
    pinName: "SUITE_UPDATE_PUBLIC_KEY",
    pinKind: "spki-pem",
    generate: "pnpm keys generate update",
    reader: "node scripts/release.mjs",
  },
};

/** The SPKI header every Ed25519 public key carries, so a raw key can be fingerprinted. */
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

function expandHome(path, env) {
  if (path === "~") return env.HOME?.trim() || homedir();
  if (path.startsWith("~/")) return join(env.HOME?.trim() || homedir(), path.slice(2));
  return path;
}

/** The directory the private keys live in. */
export function keysDir(env = process.env) {
  const override = env[KEYS_DIR_VARIABLE]?.trim();
  if (override) return resolve(expandHome(override, env));

  const home = env.HOME?.trim() || homedir();
  const config = env.XDG_CONFIG_HOME?.trim();
  return join(config ? resolve(config) : join(home, ".config"), "suite", "keys");
}

/** The path one key is read from, before checking whether it is there. */
export function keyPath(name, env = process.env) {
  const spec = KEYS[name];
  if (spec === undefined) throw new Error(`unknown key: ${name}`);
  return join(keysDir(env), spec.file);
}

/** A key's text, or null. A key that is not there is not an error; it is a state. */
export function readKey(name, env = process.env) {
  try {
    return readFileSync(keyPath(name, env), "utf8").trim();
  } catch {
    return null;
  }
}

/**
 * The public half of a private key, in the form its pin is written in.
 *
 * Throws when the text is not the algorithm the key is supposed to be: an RSA key in the Ed25519
 * slot is a mistake worth naming, not a mismatch to report as fingerprints.
 */
export function publicOf(name, privateText) {
  const spec = KEYS[name];
  if (spec === undefined) throw new Error(`unknown key: ${name}`);

  const key =
    spec.pinKind === "base64-raw"
      ? createPrivateKey({
          key: Buffer.from(privateText.replace(/\s+/gu, ""), "base64"),
          format: "der",
          type: "pkcs8",
        })
      : createPrivateKey(privateText);

  if (key.asymmetricKeyType !== "ed25519") {
    throw new Error(`${spec.label} key is ${key.asymmetricKeyType ?? "unknown"}, not Ed25519`);
  }

  const spki = createPublicKey(key).export({ type: "spki", format: "der" });
  const publicText =
    spec.pinKind === "base64-raw"
      ? spki.subarray(ED25519_SPKI_PREFIX.length).toString("base64")
      : createPublicKey(key).export({ type: "spki", format: "pem" }).trim();

  return { publicText, spki: Buffer.from(spki), privateKey: key };
}

/** The public half a pin names, or null when the constant is missing from the source. */
export function pinnedPublic(name, root = ROOT) {
  const spec = KEYS[name];
  if (spec === undefined) throw new Error(`unknown key: ${name}`);

  let source;
  try {
    source = readFileSync(join(root, spec.pinFile), "utf8");
  } catch {
    return null;
  }

  if (spec.pinKind === "base64-raw") {
    const match = new RegExp(`${spec.pinName}\\s*=\\s*"([^"]+)"`, "u").exec(source);
    return match?.[1]?.trim() ?? null;
  }

  const match = new RegExp(
    `${spec.pinName}\\s*=\\s*\`(-----BEGIN PUBLIC KEY-----[\\s\\S]*?-----END PUBLIC KEY-----)\\s*\``,
    "u",
  ).exec(source);
  return match?.[1]?.trim() ?? null;
}

/**
 * A short fingerprint of a public key: SHA-256 over the SPKI DER, first 128 bits.
 *
 * The same rule `updateKeyFingerprint()` uses in `@suite/desktop`, so a number printed here can be
 * compared with the one the app computes. A fingerprint identifies a key without exposing it.
 */
export function fingerprintOf(publicText, pinKind = "spki-pem") {
  const spki =
    pinKind === "base64-raw"
      ? Buffer.concat([ED25519_SPKI_PREFIX, Buffer.from(publicText.trim(), "base64")])
      : Buffer.from(
          createPublicKey(publicText).export({ type: "spki", format: "der" }),
        );
  return createHash("sha256").update(spki).digest("hex").slice(0, 32);
}

/** A fingerprint in groups of eight, which is the form a person reads aloud and compares. */
export function groupedFingerprint(fingerprint) {
  return fingerprint.replace(/(.{8})(?=.)/gu, "$1 ");
}

/**
 * Everything a person or a script needs to know about one key, without reading private material.
 *
 * States:
 *
 *   absent      no private key on this machine; a clean checkout is this state and it is not a fault
 *   unreadable  the file is there but is not a usable key of the expected algorithm
 *   unpinned    the pin is gone from the source, which is a bug in the tree, not in the key
 *   matches     this key signs what the tree trusts
 *   mismatch    this key signs something the tree will refuse
 */
export function inspectKey(name, { env = process.env, root = ROOT } = {}) {
  const spec = KEYS[name];
  if (spec === undefined) throw new Error(`unknown key: ${name}`);

  const path = keyPath(name, env);
  const pinned = pinnedPublic(name, root);
  const pinFingerprint = pinned === null ? null : fingerprintOf(pinned, spec.pinKind);
  const text = readKey(name, env);

  const base = { name, spec, path, pinned, pinFingerprint };

  if (text === null) {
    return { ...base, state: "absent", ok: true, fingerprint: null, detail: "not present" };
  }

  let derived;
  try {
    derived = publicOf(name, text);
  } catch (error) {
    return {
      ...base,
      state: "unreadable",
      ok: false,
      fingerprint: null,
      detail: error.message,
    };
  }

  const fingerprint = fingerprintOf(derived.publicText, spec.pinKind);

  if (pinned === null) {
    return {
      ...base,
      state: "unpinned",
      ok: false,
      fingerprint,
      detail: `${spec.pinName} is missing from ${spec.pinFile}`,
    };
  }

  const matches = normalisePublic(derived.publicText) === normalisePublic(pinned);
  return {
    ...base,
    state: matches ? "matches" : "mismatch",
    ok: matches,
    fingerprint,
    detail: matches ? `matches ${spec.pinName}` : `does not match ${spec.pinName}`,
  };
}

function normalisePublic(text) {
  return text.replace(/\r\n/gu, "\n").trim();
}

/**
 * Write a new keypair to the secret directory and print only what is public.
 *
 * The private half is created here and never leaves the file: the return value carries the public
 * half, the path and the fingerprint, and the caller prints those. `--force` is the only way to
 * replace an existing key, because replacing one silently is how a pin and a key drift apart.
 */
export function generateKey(name, { env = process.env, force = false } = {}) {
  const spec = KEYS[name];
  if (spec === undefined) throw new Error(`unknown key: ${name}`);

  const dir = keysDir(env);
  const path = join(dir, spec.file);

  let exists = true;
  try {
    statSync(path);
  } catch {
    exists = false;
  }
  if (exists && !force) {
    throw new Error(
      `${path} already exists. A second key would leave one of them unrecorded; ` +
        "pass --force only if the old key is worthless.",
    );
  }

  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);

  const { privateKey } = generateKeyPairSync("ed25519");
  const text =
    spec.pinKind === "base64-raw"
      ? privateKey.export({ type: "pkcs8", format: "der" }).toString("base64")
      : privateKey.export({ type: "pkcs8", format: "pem" }).trim();

  writeFileSync(path, `${text}\n`, { mode: 0o600 });
  chmodSync(path, 0o600);

  const derived = publicOf(name, text);
  return {
    name,
    path,
    publicText: derived.publicText,
    fingerprint: fingerprintOf(derived.publicText, spec.pinKind),
  };
}
