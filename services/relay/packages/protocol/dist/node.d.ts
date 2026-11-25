import type { RelayWebSocketFactory } from "./relayClient.js";
/**
 * The Node half of the relay client: a socket that can pin a certificate.
 *
 * The protocol itself stays free of TLS. This module is the one place that knows a `wss://`
 * connection exists, because verification has to happen where the certificate is visible —
 * below the browser WebSocket API, which deliberately hides it.
 *
 * A relay is self-signed, so ordinary chain verification would reject every honest relay.
 * Instead the chain is not trusted at all and the certificate is pinned: the handshake is
 * allowed to reach `upgrade`, the peer certificate is hashed, and the socket is destroyed
 * before the WebSocket opens if the SHA-256 does not match. There is no fallback to plaintext
 * and no "warn and continue": a mismatch is a refusal.
 */
export declare const PIN_MISMATCH_MESSAGE: string;
export declare const PIN_REQUIRED_MESSAGE: string;
export declare const PIN_MALFORMED_MESSAGE = "That is not a certificate fingerprint. Copy the SHA-256 fingerprint line suite-sync prints at startup.";
/** A refusal from the pin, carrying a sentence a person can act on. */
export declare class RelayPinError extends Error {
    constructor(message: string);
}
export interface NodeRelaySocketOptions {
    /**
     * The SHA-256 fingerprint to require on a `wss://` connection.
     *
     * Required for `wss://`. A `ws://` address carries no certificate, so this value is only
     * meaningful there as "the caller meant to pin and gave the wrong scheme" — the service
     * refuses before it gets this far.
     */
    readonly fingerprint?: string | null;
}
/**
 * A WebSocket factory that pins the relay certificate when one is supplied.
 *
 * The returned factory is synchronous, as `RelayWebSocketFactory` requires. It starts the
 * TLS handshake and inspects the peer certificate in the `upgrade` event, before the client
 * has sent a relay message or declared itself open.
 */
export declare function createNodeWebSocketFactory(options?: NodeRelaySocketOptions): RelayWebSocketFactory;
//# sourceMappingURL=node.d.ts.map