/**
 * The S3.4 conformance check: the committed golden vector verifies through an independent path, and
 * one flipped byte in the canonical form or the signature makes it fail.
 */
import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { describe, it } from "node:test";
import {
  canonicalManifestBytes,
  readGoldenVector,
  verifyGoldenVector,
} from "./spec-golden.mjs";

const GOLDEN_CANONICAL_BYTES = 1352;

function tamperedSignature(vector) {
  const signature = Buffer.from(vector.signature.trim(), "base64");
  signature[0] ^= 0x01;
  const replacement = signature.toString("base64");
  const manifest = structuredClone(vector.manifest);
  manifest.signature = replacement;
  return { ...vector, signature: replacement, manifest };
}

describe("the golden vector", () => {
  // spec: S3.4
  it("verifies with node:crypto and no @suite/pack import", () => {
    const vector = readGoldenVector();
    const result = verifyGoldenVector(vector);
    assert.deepEqual(result.problems, []);
    assert.equal(result.ok, true);
    assert.equal(result.canonicalLength, GOLDEN_CANONICAL_BYTES);
  });

  // spec: S3.4
  it("fails when one byte of the canonical form is flipped", () => {
    const vector = readGoldenVector();
    const canonical = Buffer.from(vector.canonical);
    canonical[0] ^= 0x01;
    const result = verifyGoldenVector({ ...vector, canonical });
    assert.equal(result.ok, false);
    assert.ok(
      result.problems.some((problem) => problem.includes("does not match the canonical form")),
      result.problems.join("\n"),
    );
  });

  // spec: S3.11
  it("signs and verifies a vector that carries both ring and minHost in field order", () => {
    const manifest = {
      format: "suite.pack",
      id: "rings",
      name: "Rings",
      version: "1.0.0",
      ring: "preview",
      entry: "index.html",
      contractVersion: 2,
      minHost: 2,
      capabilities: ["documents"],
      files: [
        {
          path: "index.html",
          sha256: "a".repeat(64),
          bytes: 12,
        },
      ],
    };

    const canonical = canonicalManifestBytes(manifest);
    const fields = Object.keys(JSON.parse(canonical.toString("utf8")));
    assert.equal(fields[fields.indexOf("version") + 1], "ring");
    assert.equal(fields[fields.indexOf("contractVersion") + 1], "minHost");
    assert.equal(fields.at(-1), "files");

    // A fresh ephemeral key makes this a real vector: the independent verifier
    // rebuilds the same bytes from the manifest and checks the signature.
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const signature = sign(null, canonical, privateKey);
    const publicKeyBase64 = Buffer.from(publicKey.export({ format: "jwk" }).x, "base64url").toString(
      "base64",
    );
    const vector = {
      manifest: { ...manifest, signature: signature.toString("base64") },
      manifestText: JSON.stringify(manifest),
      canonical,
      signature: signature.toString("base64"),
      publicKey: publicKeyBase64,
    };

    const result = verifyGoldenVector(vector);
    assert.deepEqual(result.problems, []);
    assert.equal(result.ok, true);
  });

  // spec: S3.4
  it("fails when one byte of the signature is flipped", () => {
    const result = verifyGoldenVector(tamperedSignature(readGoldenVector()));
    assert.equal(result.ok, false);
    assert.ok(
      result.problems.some((problem) => problem.includes("Ed25519 signature does not verify")),
      result.problems.join("\n"),
    );
  });
});
