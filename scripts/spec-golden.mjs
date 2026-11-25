#!/usr/bin/env node
/**
 * The S3.4 golden vector, verified without `@suite/pack`.
 *
 * This is the independent path: it imports `node:crypto` and nothing from the workspace. It rebuilds
 * the canonical manifest bytes from `manifest.json` with the S3.3 rules, compares them to the
 * committed `canonical.json`, and verifies the Ed25519 signature against the committed public key.
 * A second implementation can copy this file and still verify the vector.
 *
 * Usage: `node scripts/spec-golden.mjs` prints the byte count and exits non-zero on any mismatch.
 */
import { createPublicKey, verify as verifySignature } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const VECTOR_DIR = join(ROOT, "docs", "spec", "golden");

/**
 * The S3.3 field order. It is the schema's order with `signature` last and excluded, so this list and
 * the manifest's canonical form have one source.
 */
const MANIFEST_FIELD_ORDER = [
  "format",
  "id",
  "name",
  "description",
  "version",
  "ring",
  "entry",
  "contractVersion",
  "minHost",
  "minimumHostVersion",
  "publisher",
  "capabilities",
  "optionalCapabilities",
  "documents",
  "blobs",
  "sync",
  "network",
  "platforms",
  "input",
  "defaultLocale",
  "locales",
  "widgets",
  "codeWidgets",
  "components",
  "contributions",
  "subpackages",
  "addons",
  "export",
  "license",
  "source",
  "deprecated",
  "replacement",
  "sunset",
  "files",
];

/** UTF-16 code-unit order: stable everywhere, and it needs no locale data. */
function compareCodeUnits(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** Rebuild an object with code-unit-sorted keys, dropping only `undefined`. */
function canonicalJsonValue(value) {
  if (Array.isArray(value)) return value.map((item) => canonicalJsonValue(item));
  if (value !== null && typeof value === "object") {
    const ordered = {};
    for (const key of Object.keys(value).sort(compareCodeUnits)) {
      if (value[key] === undefined) continue;
      ordered[key] = canonicalJsonValue(value[key]);
    }
    return ordered;
  }
  return value;
}

/** The exact bytes S3.3 signs: fixed field order, sorted capabilities and files, no `null` holes. */
export function canonicalManifestBytes(manifest) {
  const canonical = {};
  for (const field of MANIFEST_FIELD_ORDER) {
    const value = manifest[field];
    if (value === undefined) continue;

    if (field === "capabilities" || field === "optionalCapabilities") {
      canonical[field] = [...new Set(value)].sort(compareCodeUnits);
    } else if (field === "files") {
      canonical.files = value
        .map((file) => canonicalJsonValue(file))
        .sort((left, right) => compareCodeUnits(left.path, right.path));
    } else if (field === "contributions") {
      const contributions = canonicalJsonValue(value);
      for (const key of ["fileExtensions", "deepLinks"]) {
        if (Array.isArray(contributions[key])) {
          contributions[key] = [...new Set(contributions[key])].sort(compareCodeUnits);
        }
      }
      canonical.contributions = contributions;
    } else {
      canonical[field] = canonicalJsonValue(value);
    }
  }
  return Buffer.from(JSON.stringify(canonical), "utf8");
}

/** Decode standard base64 only, and only to the expected byte length. */
function decodeBase64(text, expectedBytes) {
  const value = text.trim();
  if (!/^[A-Za-z0-9+/]*={0,2}$/u.test(value) || value.length % 4 !== 0) return null;
  const bytes = Buffer.from(value, "base64");
  return bytes.length === expectedBytes ? bytes : null;
}

/**
 * Read the committed vector. `canonical.json` is the signed file byte for byte, with no trailing
 * newline; the two `.b64` files carry one newline that `trim()` removes.
 */
export function readGoldenVector(directory = VECTOR_DIR) {
  const manifestText = readFileSync(join(directory, "manifest.json"), "utf8");
  return {
    manifest: JSON.parse(manifestText),
    manifestText,
    canonical: readFileSync(join(directory, "canonical.json")),
    signature: readFileSync(join(directory, "signature.b64"), "utf8"),
    publicKey: readFileSync(join(directory, "public-key.b64"), "utf8"),
  };
}

/**
 * Verify one vector. The result is `{ ok, canonicalLength, problems }`; every check contributes a
 * problem instead of throwing, so a tamper test can name which one failed.
 */
export function verifyGoldenVector(vector) {
  const problems = [];

  const canonical = Buffer.isBuffer(vector.canonical)
    ? vector.canonical
    : Buffer.from(vector.canonical ?? "");
  const recomputed = canonicalManifestBytes(vector.manifest);
  if (!canonical.equals(recomputed)) {
    problems.push(
      `canonical.json (${canonical.length} bytes) does not match the canonical form rebuilt from manifest.json (${recomputed.length} bytes)`,
    );
  }

  const signatureText = String(vector.signature ?? "").trim();
  if (signatureText !== String(vector.manifest.signature ?? "").trim()) {
    problems.push("signature.b64 does not match manifest.signature");
  }

  const signature = decodeBase64(signatureText, 64);
  if (signature === null) {
    problems.push("signature.b64 is not standard base64 of 64 bytes");
  }

  const publicKeyBytes = decodeBase64(String(vector.publicKey ?? ""), 32);
  if (publicKeyBytes === null) {
    problems.push("public-key.b64 is not standard base64 of 32 bytes");
  }

  if (signature !== null && publicKeyBytes !== null) {
    try {
      const publicKey = createPublicKey({
        key: {
          kty: "OKP",
          crv: "Ed25519",
          x: publicKeyBytes.toString("base64url"),
        },
        format: "jwk",
      });
      if (!verifySignature(null, canonical, publicKey, signature)) {
        problems.push("Ed25519 signature does not verify over canonical.json");
      }
    } catch (error) {
      problems.push(`Ed25519 verification failed: ${error instanceof Error ? error.message : error}`);
    }
  }

  return {
    ok: problems.length === 0,
    canonicalLength: canonical.length,
    problems,
  };
}

const entry = process.argv[1] === undefined ? null : resolve(process.argv[1]);
if (entry !== null && entry === fileURLToPath(import.meta.url)) {
  const result = verifyGoldenVector(readGoldenVector());
  if (!result.ok) {
    for (const problem of result.problems) console.error(`spec-golden: ${problem}`);
    process.exit(1);
  }
  console.log(
    `spec-golden: ${result.canonicalLength} canonical bytes, Ed25519 signature verified against the committed public key.`,
  );
}
