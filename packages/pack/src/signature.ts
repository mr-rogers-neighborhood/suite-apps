import { hashes, keygen, sign as nobleSign, verify as nobleVerify } from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha2.js";
import {
  canonicalManifestBytes,
  comparePackPaths,
  type PackFile,
  type PackManifest,
  type PackManifestCore,
} from "./manifest.js";

/**
 * Ed25519 over the manifest, and SHA-256 over the files.
 *
 * A pure implementation, explicitly configured, rather than WebCrypto: a WebView
 * without Ed25519 used to answer `false` and blame the pack for the host's
 * shortcoming. `@noble` is the same family the sync protocol uses.
 */
hashes.sha512 = sha512;

export function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** A fresh Ed25519 pair, base64. The secret half is a release secret. */
export async function generatePackKeyPair(): Promise<{
  readonly secretKeyBase64: string;
  readonly publicKeyBase64: string;
}> {
  const keys = await keygen();
  return {
    secretKeyBase64: bytesToBase64(keys.secretKey),
    publicKeyBase64: bytesToBase64(keys.publicKey),
  };
}

/**
 * Sign arbitrary bytes with an Ed25519 secret key.
 *
 * A manifest is not the only signed object in the trust model: a key rotation
 * statement and a revocation advisory are signed the same way (S2.3, S2.4). They
 * define their own canonical bytes; this is only the primitive.
 */
export function signBytes(bytes: Uint8Array, privateKeyBase64: string): string {
  return bytesToBase64(nobleSign(bytes, base64ToBytes(privateKeyBase64)));
}

/** Verify a detached Ed25519 signature over arbitrary bytes. */
export function verifyBytes(
  signatureBase64: string,
  bytes: Uint8Array,
  publicKeyBase64: string,
): boolean {
  try {
    return nobleVerify(base64ToBytes(signatureBase64), bytes, base64ToBytes(publicKeyBase64));
  } catch {
    return false;
  }
}

/** Sign a manifest core. The build script adds the returned `signature`. */
export function signPackManifest(manifest: PackManifestCore, privateKeyBase64: string): string {
  return signBytes(canonicalManifestBytes(manifest), privateKeyBase64);
}

export async function verifyPackSignature(
  manifest: PackManifest,
  publicKeyBase64: string,
): Promise<boolean> {
  return verifyBytes(manifest.signature, canonicalManifestBytes(manifest), publicKeyBase64);
}

export interface PackFileMismatch {
  readonly path: string;
  readonly reason: "missing" | "hash" | "size";
}

export async function verifyPackFiles(
  manifest: PackManifest,
  read: (path: string) => Promise<Uint8Array | null>,
): Promise<readonly PackFileMismatch[]> {
  const mismatches: PackFileMismatch[] = [];
  for (const file of manifest.files) {
    const bytes = await read(file.path);
    if (bytes === null) {
      mismatches.push({ path: file.path, reason: "missing" });
      continue;
    }
    if (bytes.byteLength !== file.bytes) {
      mismatches.push({ path: file.path, reason: "size" });
      continue;
    }
    if ((await sha256Hex(bytes)) !== file.sha256) {
      mismatches.push({ path: file.path, reason: "hash" });
    }
  }
  return mismatches;
}

/** Hash a set of files for a manifest. Paths are relative and slash-separated. */
export async function digestPackFiles(
  files: Readonly<Record<string, Uint8Array>>,
): Promise<readonly PackFile[]> {
  const entries: PackFile[] = [];
  for (const [path, bytes] of Object.entries(files)) {
    entries.push({ path, sha256: await sha256Hex(bytes), bytes: bytes.byteLength });
  }
  return entries.sort((left, right) => comparePackPaths(left.path, right.path));
}
