/**
 * Certificate fingerprints, in the one shape both a relay and an app write them.
 *
 * A TLS pin is the SHA-256 of a certificate's DER bytes, written as upper-case hex pairs
 * joined by colons. That is what `openssl x509 -fingerprint -sha256` prints, what a person
 * can read out loud, and what a client compares byte for byte. The relay is self-signed:
 * there is no authority to trust, so this value is the trust root and it must be exact.
 */
/** Format a 64-character SHA-256 digest as `AB:CD:…:89`. */
export declare function formatFingerprint(digestHex: string): string;
/**
 * Read a fingerprint a person copied from anywhere.
 *
 * Accepts a bare digest, colon-separated pairs, either case, and an optional `sha256:`
 * prefix, because all four are what a terminal or a certificate viewer hands over. Returns
 * null rather than guessing when the value is not a SHA-256 digest.
 */
export declare function normaliseFingerprint(value: string): string | null;
//# sourceMappingURL=fingerprint.d.ts.map