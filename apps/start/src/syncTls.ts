import {
  createHash,
  createPrivateKey,
  generateKeyPairSync,
  randomBytes,
  sign,
  X509Certificate,
} from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { formatFingerprint } from "@suite/sync";

/**
 * The certificate Start gives the relay it runs.
 *
 * A relay is a person's mailbox, not a certificate authority's, so the pair is
 * self-signed and trust is a SHA-256 pin. Start owns the pair because it owns the
 * relay's data directory: the fingerprint a device pins has to survive every
 * restart, and a certificate the relay generated on each boot would silently
 * unpin every app.
 *
 * The pair is made here rather than by shelling out to `openssl`, because Start
 * ships as an AppImage and a Flatpak on machines that may not have it. Node's
 * crypto can make the key; the small DER writer below makes the one certificate
 * shape a self-signed TLS server needs.
 */

export interface RelayCertificate {
  readonly certPath: string;
  readonly keyPath: string;
  /** The SHA-256 of the certificate's DER bytes, as `openssl` prints it. */
  readonly fingerprint: string;
}

const CERT_FILE = "relay-cert.pem";
const KEY_FILE = "relay-key.pem";

/**
 * Read the pair Start already keeps, or make one and write both halves mode 0600.
 *
 * Neither half is replaced on its own. A certificate whose key is missing cannot
 * serve, and quietly minting a new pair would change the fingerprint every app
 * pinned. The caller gets a sentence instead.
 */
export function ensureRelayCertificate(directory: string): RelayCertificate {
  mkdirSync(directory, { recursive: true, mode: 0o700 });

  const certPath = join(directory, CERT_FILE);
  const keyPath = join(directory, KEY_FILE);
  const hasCert = existsSync(certPath);
  const hasKey = existsSync(keyPath);

  if (hasCert && hasKey) {
    return reuse(certPath, keyPath);
  }

  if (hasCert || hasKey) {
    const missing = hasCert ? keyPath : certPath;
    throw new Error(
      `the relay certificate pair is incomplete: ${missing} is missing. ` +
        "Replace the pair together rather than letting Start guess.",
    );
  }

  const generated = generate();
  writePrivate(certPath, generated.certPem);
  writePrivate(keyPath, generated.keyPem);
  return { certPath, keyPath, fingerprint: fingerprintOf(generated.cert) };
}

function reuse(certPath: string, keyPath: string): RelayCertificate {
  const certPem = readFileSync(certPath, "utf8");
  const keyPem = readFileSync(keyPath, "utf8");

  let cert: X509Certificate;
  try {
    cert = new X509Certificate(certPem);
  } catch {
    throw new Error(`${certPath} is not a certificate Start can read.`);
  }

  let matches: boolean;
  try {
    matches = cert.checkPrivateKey(createPrivateKey(keyPem));
  } catch {
    throw new Error(`${keyPath} is not the private key for ${certPath}.`);
  }
  if (!matches) {
    throw new Error(`${keyPath} is not the private key for ${certPath}.`);
  }

  // A pair copied from somewhere else may be readable by more than its owner.
  chmodSync(certPath, 0o600);
  chmodSync(keyPath, 0o600);
  return { certPath, keyPath, fingerprint: fingerprintOf(cert) };
}

function fingerprintOf(cert: X509Certificate): string {
  return formatFingerprint(createHash("sha256").update(cert.raw).digest("hex"));
}

function writePrivate(path: string, contents: string): void {
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, contents, { mode: 0o600, flag: "w" });
  renameSync(temporary, path);
  chmodSync(path, 0o600);
}

interface GeneratedPair {
  readonly certPem: string;
  readonly keyPem: string;
  readonly cert: X509Certificate;
}

/**
 * Make one self-signed P-256 certificate.
 *
 * P-256 rather than Ed25519 because a browser may open the console over TLS one
 * day and the older curve is the one every TLS stack accepts. The CN is a label,
 * not an identity: a client pins the hash, it does not check the name.
 */
function generate(): GeneratedPair {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const spki = publicKey.export({ type: "spki", format: "der" });
  const algorithm = sequence(oid(ECDSA_WITH_SHA256));
  const name = sequence(set(sequence(oid(COMMON_NAME), utf8("Suite Start relay"))));

  const now = Date.now();
  const notBefore = new Date(now - 24 * 60 * 60 * 1000);
  // Ten years is long enough that a household relay never surprises its devices
  // with an expiry, and short enough that the pair is not a permanent identity.
  const notAfter = new Date(now + 3650 * 24 * 60 * 60 * 1000);

  const serial = randomBytes(16);
  serial[0] = (serial[0] ?? 0) & 0x7f;
  if (serial.every((byte) => byte === 0)) serial[serial.length - 1] = 1;

  const tbs = sequence(
    // version [0] EXPLICIT INTEGER 2 (v3)
    der(0xa0, integer(Buffer.from([0x02]))),
    integer(serial),
    algorithm,
    name,
    sequence(utcTime(notBefore), utcTime(notAfter)),
    name,
    spki,
  );
  const derCertificate = sequence(tbs, algorithm, bitString(sign("sha256", tbs, privateKey)));
  const certPem = pem("CERTIFICATE", derCertificate);
  const keyPem = String(privateKey.export({ type: "pkcs8", format: "pem" }));

  return { certPem, keyPem, cert: new X509Certificate(certPem) };
}

/** 1.2.840.10045.4.3.2 — ecdsa-with-SHA256. */
const ECDSA_WITH_SHA256 = Buffer.from([0x2a, 0x86, 0x48, 0xce, 0x3d, 0x04, 0x03, 0x02]);
/** 2.5.4.3 — commonName. */
const COMMON_NAME = Buffer.from([0x55, 0x04, 0x03]);

function pem(label: string, derBytes: Buffer): string {
  const body =
    derBytes
      .toString("base64")
      .match(/.{1,64}/gu)
      ?.join("\n") ?? "";
  return `-----BEGIN ${label}-----\n${body}\n-----END ${label}-----\n`;
}

function der(tag: number, value: Buffer): Buffer {
  return Buffer.concat([Buffer.from([tag]), derLength(value.length), value]);
}

function derLength(length: number): Buffer {
  if (length < 0x80) return Buffer.from([length]);
  const bytes: number[] = [];
  let remaining = length;
  while (remaining > 0) {
    bytes.unshift(remaining & 0xff);
    remaining = Math.floor(remaining / 256);
  }
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}

function sequence(...parts: Buffer[]): Buffer {
  return der(0x30, Buffer.concat(parts));
}

function set(...parts: Buffer[]): Buffer {
  return der(0x31, Buffer.concat(parts));
}

function integer(value: Buffer): Buffer {
  // A DER INTEGER is signed, so a leading bit set would read as negative.
  return der(0x02, (value[0] ?? 0) & 0x80 ? Buffer.concat([Buffer.from([0]), value]) : value);
}

function oid(value: Buffer): Buffer {
  return der(0x06, value);
}

function utf8(value: string): Buffer {
  return der(0x0c, Buffer.from(value, "utf8"));
}

function utcTime(value: Date): Buffer {
  const iso = value.toISOString();
  const stamp =
    iso.slice(2, 4) +
    iso.slice(5, 7) +
    iso.slice(8, 10) +
    iso.slice(11, 13) +
    iso.slice(14, 16) +
    iso.slice(17, 19) +
    "Z";
  return der(0x17, Buffer.from(stamp, "ascii"));
}

function bitString(value: Buffer): Buffer {
  return der(0x03, Buffer.concat([Buffer.from([0]), value]));
}
