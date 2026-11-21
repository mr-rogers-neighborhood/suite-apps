import { createHash, createPrivateKey, generateKeyPairSync, randomBytes, sign, X509Certificate, } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync, } from "node:fs";
import { join } from "node:path";
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
const CERT_FILE = "relay-cert.pem";
const KEY_FILE = "relay-key.pem";
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
export function ensureSelfSignedPair(directory, options = {}) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const certPath = join(directory, CERT_FILE);
    const keyPath = join(directory, KEY_FILE);
    const hasCert = existsSync(certPath);
    const hasKey = existsSync(keyPath);
    if (hasCert && hasKey)
        return reuse(certPath, keyPath);
    if (hasCert || hasKey) {
        const missing = hasCert ? keyPath : certPath;
        throw new Error(`the relay certificate pair is incomplete: ${missing} is missing. ` +
            "Replace the pair together rather than letting the host guess.");
    }
    const generated = generate(options.commonName ?? "Suite relay");
    try {
        writePrivate(certPath, generated.certPem);
        writePrivate(keyPath, generated.keyPem);
    }
    catch (error) {
        // A half-written pair would make every later start refuse forever. A partial write is
        // not a rotation anybody asked for, so remove what was attempted.
        rmSync(certPath, { force: true });
        rmSync(keyPath, { force: true });
        throw error;
    }
    return { certPath, keyPath, fingerprint: fingerprintOf(generated.cert) };
}
function reuse(certPath, keyPath) {
    const certPem = readFileSync(certPath, "utf8");
    const keyPem = readFileSync(keyPath, "utf8");
    let cert;
    try {
        cert = new X509Certificate(certPem);
    }
    catch {
        throw new Error(`${certPath} is not a certificate the host can read.`);
    }
    let matches;
    try {
        matches = cert.checkPrivateKey(createPrivateKey(keyPem));
    }
    catch {
        throw new Error(`${keyPath} is not the private key for ${certPath}.`);
    }
    if (!matches)
        throw new Error(`${keyPath} is not the private key for ${certPath}.`);
    // A pair copied from somewhere else may be readable by more than its owner.
    chmodSync(certPath, 0o600);
    chmodSync(keyPath, 0o600);
    return { certPath, keyPath, fingerprint: fingerprintOf(cert) };
}
function fingerprintOf(cert) {
    return formatFingerprint(createHash("sha256").update(cert.raw).digest("hex"));
}
function writePrivate(path, contents) {
    const temporary = `${path}.${process.pid}.tmp`;
    writeFileSync(temporary, contents, { mode: 0o600, flag: "w" });
    renameSync(temporary, path);
    chmodSync(path, 0o600);
}
/**
 * Make one self-signed P-256 certificate.
 *
 * P-256 rather than Ed25519 because a browser may open the console over TLS one day and the
 * older curve is the one every TLS stack accepts. The CN is a label, not an identity: a
 * client pins the hash, it does not check the name.
 */
function generate(commonName) {
    const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    const spki = publicKey.export({ type: "spki", format: "der" });
    const algorithm = sequence(oid(ECDSA_WITH_SHA256));
    const name = sequence(set(sequence(oid(COMMON_NAME), utf8(commonName))));
    const now = Date.now();
    const notBefore = new Date(now - 24 * 60 * 60 * 1000);
    // Ten years is long enough that a household relay never surprises its devices with an
    // expiry, and short enough that the pair is not a permanent identity.
    const notAfter = new Date(now + 3650 * 24 * 60 * 60 * 1000);
    const serial = randomBytes(16);
    // A DER INTEGER is minimal: no leading zero byte, and a leading bit set would read as
    // negative. Masking the top bit and refusing zero keeps both true without a padding byte —
    // a serial that started with 0x00 made OpenSSL reject the certificate as illegal padding,
    // roughly once in a hundred generations.
    serial[0] = (serial[0] ?? 0) & 0x7f;
    if (serial[0] === 0)
        serial[0] = 1;
    const tbs = sequence(
    // version [0] EXPLICIT INTEGER 2 (v3)
    der(0xa0, integer(Buffer.from([0x02]))), integer(serial), algorithm, name, sequence(utcTime(notBefore), utcTime(notAfter)), name, spki);
    const derCertificate = sequence(tbs, algorithm, bitString(sign("sha256", tbs, privateKey)));
    const certPem = pem("CERTIFICATE", derCertificate);
    const keyPem = String(privateKey.export({ type: "pkcs8", format: "pem" }));
    return { certPem, keyPem, cert: new X509Certificate(certPem) };
}
/** 1.2.840.10045.4.3.2 — ecdsa-with-SHA256. */
const ECDSA_WITH_SHA256 = Buffer.from([0x2a, 0x86, 0x48, 0xce, 0x3d, 0x04, 0x03, 0x02]);
/** 2.5.4.3 — commonName. */
const COMMON_NAME = Buffer.from([0x55, 0x04, 0x03]);
function pem(label, derBytes) {
    const body = derBytes
        .toString("base64")
        .match(/.{1,64}/gu)
        ?.join("\n") ?? "";
    return `-----BEGIN ${label}-----\n${body}\n-----END ${label}-----\n`;
}
function der(tag, value) {
    return Buffer.concat([Buffer.from([tag]), derLength(value.length), value]);
}
function derLength(length) {
    if (length < 0x80)
        return Buffer.from([length]);
    const bytes = [];
    let remaining = length;
    while (remaining > 0) {
        bytes.unshift(remaining & 0xff);
        remaining = Math.floor(remaining / 256);
    }
    return Buffer.from([0x80 | bytes.length, ...bytes]);
}
function sequence(...parts) {
    return der(0x30, Buffer.concat(parts));
}
function set(...parts) {
    return der(0x31, Buffer.concat(parts));
}
function integer(value) {
    // A DER INTEGER is signed, so a leading bit set would read as negative.
    return der(0x02, (value[0] ?? 0) & 0x80 ? Buffer.concat([Buffer.from([0]), value]) : value);
}
function oid(value) {
    return der(0x06, value);
}
function utf8(value) {
    return der(0x0c, Buffer.from(value, "utf8"));
}
function utcTime(value) {
    const iso = value.toISOString();
    const stamp = iso.slice(2, 4) +
        iso.slice(5, 7) +
        iso.slice(8, 10) +
        iso.slice(11, 13) +
        iso.slice(14, 16) +
        iso.slice(17, 19) +
        "Z";
    return der(0x17, Buffer.from(stamp, "ascii"));
}
function bitString(value) {
    return der(0x03, Buffer.concat([Buffer.from([0]), value]));
}
//# sourceMappingURL=tls.js.map