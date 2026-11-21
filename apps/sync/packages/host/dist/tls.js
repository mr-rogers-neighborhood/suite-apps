import { createHash, X509Certificate } from "node:crypto";
import { formatFingerprint } from "@suite/sync";
/**
 * Would binding this address expose the process beyond the machine?
 *
 * `0.0.0.0` and `::` are wildcards, not loopback: they listen everywhere, which is exactly the
 * case that needs saying out loud. Everything unrecognised is treated as reachable, because
 * the failure of guessing wrong in that direction is an open relay.
 */
export function isLoopbackHost(host) {
    const normalized = host.trim().toLowerCase().replace(/^\[/u, "").replace(/\]$/u, "");
    if (normalized === "localhost" || normalized === "::1")
        return true;
    const octets = /^127\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/u.exec(normalized);
    if (octets === null)
        return false;
    return octets.slice(1).every((part) => Number(part) <= 255);
}
/** The SHA-256 of a certificate's DER bytes, in the shape `openssl` prints. */
export function certificateFingerprint(cert) {
    const der = new X509Certificate(cert).raw;
    return formatFingerprint(createHash("sha256").update(der).digest("hex"));
}
/** The one startup line a person copies into an app. */
export function fingerprintLine(fingerprint) {
    return `certificate SHA-256 fingerprint: ${fingerprint}`;
}
//# sourceMappingURL=tls.js.map