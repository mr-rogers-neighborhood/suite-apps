import { createHash } from "node:crypto";
import { Agent } from "node:https";
import WebSocket from "ws";
import { formatFingerprint, normaliseFingerprint } from "./fingerprint.js";
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
export const PIN_MISMATCH_MESSAGE = "The relay's certificate does not match the fingerprint pinned for this workspace. " +
    "Check the SHA-256 fingerprint the relay printed at startup and enter it again; nothing was connected.";
export const PIN_REQUIRED_MESSAGE = "This relay uses wss://, so its certificate fingerprint is required. " +
    "Copy the SHA-256 fingerprint line suite-sync prints at startup.";
export const PIN_MALFORMED_MESSAGE = "That is not a certificate fingerprint. Copy the SHA-256 fingerprint line suite-sync prints at startup.";
/** A refusal from the pin, carrying a sentence a person can act on. */
export class RelayPinError extends Error {
    constructor(message) {
        super(message);
        this.name = "RelayPinError";
    }
}
/**
 * A WebSocket factory that pins the relay certificate when one is supplied.
 *
 * The returned factory is synchronous, as `RelayWebSocketFactory` requires. It starts the
 * TLS handshake and inspects the peer certificate in the `upgrade` event, before the client
 * has sent a relay message or declared itself open.
 */
export function createNodeWebSocketFactory(options = {}) {
    const pinned = options.fingerprint === undefined || options.fingerprint === null
        ? null
        : normaliseFingerprint(options.fingerprint);
    if (options.fingerprint !== undefined && options.fingerprint !== null && pinned === null) {
        throw new RelayPinError(PIN_MALFORMED_MESSAGE);
    }
    return (url) => connect(url, pinned);
}
function connect(url, pinned) {
    const secure = url.trim().toLowerCase().startsWith("wss://");
    if (secure && pinned === null)
        throw new RelayPinError(PIN_REQUIRED_MESSAGE);
    const socket = new WebSocket(url, {
        // The relay is self-signed. The chain is not the trust decision; the pin is.
        ...(secure
            ? {
                rejectUnauthorized: false,
                // A resumed TLS session reports no peer certificate, which would read as a
                // mismatch on the second connection to a perfectly good relay. Each relay socket
                // is long-lived, so nothing is lost by not caching sessions.
                agent: new Agent({ maxCachedSessions: 0 }),
            }
            : {}),
    });
    const open = [];
    const message = [];
    const close = [];
    const error = [];
    const fail = (cause) => {
        for (const listener of error)
            listener({ error: cause });
    };
    socket.on("open", () => {
        for (const listener of open)
            listener();
    });
    socket.on("message", (data) => {
        for (const listener of message)
            listener({ data });
    });
    socket.on("close", () => {
        for (const listener of close)
            listener();
    });
    socket.on("error", (cause) => fail(cause));
    if (secure) {
        socket.on("upgrade", (response) => {
            const actual = peerFingerprint(response.socket);
            if (actual === pinned)
                return;
            fail(new RelayPinError(PIN_MISMATCH_MESSAGE));
            // Not `close()`: a close sends a frame that the certificate has not earned. Destroy
            // the socket and let the client's error path report the refusal.
            response.socket.destroy();
            socket.terminate();
        });
    }
    const adapter = {
        send: (data) => socket.send(data),
        close: () => socket.close(),
        addEventListener(type, listener) {
            switch (type) {
                case "open":
                    open.push(listener);
                    return;
                case "message":
                    message.push(listener);
                    return;
                case "close":
                    close.push(listener);
                    return;
                case "error":
                    error.push(listener);
                    return;
            }
        },
    };
    return adapter;
}
function peerFingerprint(socket) {
    if (socket === null || socket === undefined)
        return null;
    const tls = socket;
    if (typeof tls.getPeerCertificate !== "function")
        return null;
    const certificate = tls.getPeerCertificate();
    if (certificate === null || certificate.raw === undefined)
        return null;
    return formatFingerprint(createHash("sha256").update(certificate.raw).digest("hex"));
}
//# sourceMappingURL=node.js.map