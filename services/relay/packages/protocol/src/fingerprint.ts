/**
 * Certificate fingerprints, in the one shape both a relay and an app write them.
 *
 * A TLS pin is the SHA-256 of a certificate's DER bytes, written as upper-case hex pairs
 * joined by colons. That is what `openssl x509 -fingerprint -sha256` prints, what a person
 * can read out loud, and what a client compares byte for byte. The relay is self-signed:
 * there is no authority to trust, so this value is the trust root and it must be exact.
 */

const FINGERPRINT_LENGTH = 64;

/** Format a 64-character SHA-256 digest as `AB:CD:…:89`. */
export function formatFingerprint(digestHex: string): string {
  const hex = digestHex.trim().replace(/[\s:]/gu, "").toUpperCase();
  if (!/^[0-9A-F]{64}$/u.test(hex)) {
    throw new Error("a fingerprint is 64 hexadecimal characters");
  }
  return hex.match(/.{2}/gu)?.join(":") ?? hex;
}

/**
 * Read a fingerprint a person copied from anywhere.
 *
 * Accepts a bare digest, colon-separated pairs, either case, and an optional `sha256:`
 * prefix, because all four are what a terminal or a certificate viewer hands over. Returns
 * null rather than guessing when the value is not a SHA-256 digest.
 */
export function normaliseFingerprint(value: string): string | null {
  const trimmed = value.trim().replace(/^sha-?256\s*[:=]?\s*/iu, "");
  const hex = trimmed.replace(/[\s:]/gu, "");
  if (hex.length !== FINGERPRINT_LENGTH || !/^[0-9a-f]+$/iu.test(hex)) return null;
  return formatFingerprint(hex);
}
