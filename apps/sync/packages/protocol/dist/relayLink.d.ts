/**
 * The payload a future phone scans to meet a relay.
 *
 * It is a URL for the same reasons an invitation is: it survives chat clients, it
 * is one line, and a person can see what kind of thing it is. Three facts travel
 * here — where the relay is, the certificate to pin, and an invitation when the
 * owner has one to give. The fingerprint is not a secret; it is the trust root a
 * self-signed relay has instead of a certificate authority.
 *
 * `f` is required for `wss://`: a pinned relay without its pin is a connection
 * that cannot make the decision the pin exists for. A loopback `ws://` relay
 * carries no certificate, so `f` may be absent there; if one is present anyway,
 * a client that knows the scheme is plaintext ignores it.
 *
 * `w` and `i` travel together. An invitation id alone names no workspace, and a
 * workspace alone is not an invitation.
 */
export declare const RELAY_LINK_SCHEME = "suite";
export declare const RELAY_LINK_HOST = "relay";
export interface RelayLinkDetails {
    /** The relay's WebSocket address, `ws://` or `wss://`, ending in `/sync`. */
    readonly url: string;
    /** The SHA-256 certificate fingerprint, when the relay serves TLS. */
    readonly fingerprint: string | null;
    /** The workspace an optional invitation is for. */
    readonly workspaceId: string | null;
    /** A bearer invitation token, when the owner put one in this payload. */
    readonly inviteId: string | null;
}
export type RelayLinkParse = {
    readonly ok: true;
    readonly value: RelayLinkDetails;
} | {
    readonly ok: false;
    readonly reason: string;
};
export declare function formatRelayLink(details: RelayLinkDetails): string;
export declare function parseRelayLink(text: string): RelayLinkParse;
//# sourceMappingURL=relayLink.d.ts.map