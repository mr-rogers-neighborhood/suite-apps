/**
 * TLS material and the two decisions that go with it.
 *
 * A Suite relay is run by a person, not by a certificate authority, so its certificate is
 * self-signed and the trust decision is a SHA-256 pin. This module owns the two things both
 * the host and the CLI must agree on: which addresses may be plaintext, and how a
 * certificate becomes a fingerprint a person can read out loud.
 */
export interface TlsMaterial {
    /** A PEM certificate, or its DER bytes. */
    readonly cert: string | Buffer;
    /** The matching PEM private key. It never leaves the host process. */
    readonly key: string | Buffer;
}
/**
 * Would binding this address expose the process beyond the machine?
 *
 * `0.0.0.0` and `::` are wildcards, not loopback: they listen everywhere, which is exactly the
 * case that needs saying out loud. Everything unrecognised is treated as reachable, because
 * the failure of guessing wrong in that direction is an open relay.
 */
export declare function isLoopbackHost(host: string): boolean;
/** The SHA-256 of a certificate's DER bytes, in the shape `openssl` prints. */
export declare function certificateFingerprint(cert: string | Buffer): string;
/** The one startup line a person copies into an app. */
export declare function fingerprintLine(fingerprint: string): string;
/** Where a pair the host made for itself lives, and what a device pins. */
export interface RelayCertificatePair {
    readonly certPath: string;
    readonly keyPath: string;
    /** The SHA-256 of the certificate's DER bytes, as `openssl` prints it. */
    readonly fingerprint: string;
}
/**
 * Read the pair this store already keeps, or make one and write both halves mode 0600.
 *
 * An app that embeds a relay owns the pair for the same reason it owns the store: the
 * fingerprint every device pins has to survive a restart, and a certificate minted on each
 * launch would silently unpin them all.
 *
 * Neither half is replaced on its own. A certificate whose key is missing cannot serve, and
 * guessing a replacement would rotate the fingerprint without anybody asking for it, so the
 * caller gets a sentence instead.
 *
 * The pair is made here rather than by shelling out to `openssl`: the Flatpak this serves
 * carries no `openssl`, and Node's crypto can make the one key and certificate shape a
 * self-signed TLS server needs.
 */
export declare function ensureSelfSignedPair(directory: string, options?: {
    readonly commonName?: string;
}): RelayCertificatePair;
//# sourceMappingURL=tls.d.ts.map