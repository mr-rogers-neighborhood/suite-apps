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

/** Sign a manifest core. The build script adds the returned `signature`. */
export function signPackManifest(manifest: PackManifestCore, privateKeyBase64: string): string {
  const signature = nobleSign(canonicalManifestBytes(manifest), base64ToBytes(privateKeyBase64));
  return bytesToBase64(signature);
}

export async function verifyPackSignature(
  manifest: PackManifest,
  publicKeyBase64: string,
): Promise<boolean> {
  try {
    return nobleVerify(
      base64ToBytes(manifest.signature),
      canonicalManifestBytes(manifest),
      base64ToBytes(publicKeyBase64),
    );
  } catch {
    return false;
  }
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
